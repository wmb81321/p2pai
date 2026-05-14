import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Router } from '../lib/router.js'
import { readJsonBody, json } from '../lib/router.js'
import { db, updateTradeStatus } from '../lib/supabase.js'
import { markPaymentSent, confirmPayment } from '../flows/flowManual.js'
import { chargeServiceFee } from '../lib/mppx.js'
import { watchDeposit } from '../tempo/monitor.js'
import { transferUsdc } from '../tempo/wallet.js'
import { ENV } from '../lib/env.js'

const DEPOSIT_TIMEOUT_MS = 30 * 60 * 1000

const CreateTradeBody = z.object({
  order_id:       z.string().uuid(),
  buyer_address:  z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  seller_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  usdc_amount:    z.number().positive(),
  usd_amount:     z.number().positive(),
})

const CancelTradeBody = z.object({
  canceller_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/i),
})

const RejectCancelBody = z.object({
  rejector_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/i),
})


const PaymentSentBody = z.object({
  buyer_address:     z.string().regex(/^0x[0-9a-fA-F]{40}$/i),
  payment_method:    z.string().min(1).max(50),
  payment_reference: z.string().min(1).max(200),
  payment_proof_url: z.string().url().optional(),
})

const ConfirmPaymentBody = z.object({
  seller_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/i),
})

export function registerTradeRoutes(router: Router): void {

  // POST /trades — taker pays 0.1 USDC service fee, then trade is created
  router.post('/trades', async (req, res) => {
    const parsed = CreateTradeBody.safeParse(await readJsonBody(req))
    if (!parsed.success) {
      json(res, 400, { error: parsed.error.issues[0]?.message ?? 'Invalid input' })
      return
    }
    const body = parsed.data

    // externalId ties the charge to this (taker, order) pair — retries don't double-charge
    const takerFeeId = `taker_${body.buyer_address.toLowerCase()}_${body.order_id}`
    const charge = await chargeServiceFee(req, res, takerFeeId)
    if (charge.status === 402) return

    const deadline = new Date(Date.now() + DEPOSIT_TIMEOUT_MS).toISOString()

    // Atomically lock the order — concurrent requests find status != 'open' and get 409.
    // Also select fields needed for role validation and amount enforcement.
    const { data: matchedOrder, error: matchError } = await db
      .from('orders')
      .update({ status: 'matched' })
      .eq('id', body.order_id)
      .eq('status', 'open')
      .select('id, virtual_deposit_address, user_address, type, usdc_amount, usd_amount')
      .maybeSingle()

    if (matchError) throw new Error(`Failed to match order: ${matchError.message}`)
    if (!matchedOrder) {
      json(res, 409, { error: 'Order is no longer available' })
      return
    }

    if (!matchedOrder.virtual_deposit_address) {
      // Legacy order created before migration 007 — no VA, cannot match.
      await db.from('orders').update({ status: 'open' }).eq('id', body.order_id)
      json(res, 409, { error: 'Order has no deposit address — cancel and re-create' })
      return
    }

    // Verify party roles: the order creator must occupy the correct role.
    // SELL order → creator is seller (deposits USDC); BUY order → creator is buyer (receives USDC).
    // Without this check an attacker can supply any seller_address and intercept the USDC release.
    const orderCreator = matchedOrder.user_address.toLowerCase()
    if (matchedOrder.type === 'sell' && orderCreator !== body.seller_address.toLowerCase()) {
      await db.from('orders').update({ status: 'open' }).eq('id', body.order_id)
      json(res, 403, { error: 'seller_address must match the order creator for SELL orders' })
      return
    }
    if (matchedOrder.type === 'buy' && orderCreator !== body.buyer_address.toLowerCase()) {
      await db.from('orders').update({ status: 'open' }).eq('id', body.order_id)
      json(res, 403, { error: 'buyer_address must match the order creator for BUY orders' })
      return
    }

    // Use amounts from the locked order row — never trust body amounts.
    // Taker forging usdc_amount could cause the deposit watcher to require the wrong amount.
    const tradeUsdcAmount = matchedOrder.usdc_amount
    const tradeUsdAmount  = matchedOrder.usd_amount

    const tradeId = randomUUID()
    const virtualAddress = matchedOrder.virtual_deposit_address as `0x${string}`

    await db.from('users').upsert(
      [{ address: body.buyer_address }, { address: body.seller_address }],
      { onConflict: 'address', ignoreDuplicates: true },
    )

    const { data: trade, error: insertError } = await db
      .from('trades')
      .insert({
        id:                      tradeId,
        order_id:                body.order_id,
        buyer_address:           body.buyer_address,
        seller_address:          body.seller_address,
        usdc_amount:             tradeUsdcAmount,
        usd_amount:              tradeUsdAmount,
        deposit_deadline:        deadline,
        virtual_deposit_address: virtualAddress,
        status:                  'created',
      })
      .select('id')
      .single()

    if (insertError ?? !trade) {
      await db.from('orders').update({ status: 'open' }).eq('id', body.order_id)
      throw new Error(`Failed to create trade: ${insertError?.message ?? 'no data'}`)
    }

    const expectedAmount = BigInt(Math.round(tradeUsdcAmount * 1e6))
    const deadlineMs = Date.now() + DEPOSIT_TIMEOUT_MS

    watchDeposit(
      virtualAddress,
      trade.id,
      ENV.TEMPO_PATHUSDC_ADDRESS as `0x${string}`,
      expectedAmount,
      deadlineMs,
    ).then(async (result) => {
      if (result === 'timeout') {
        await updateTradeStatus(trade.id, 'deposit_timeout')
        console.log(`[trades] Trade ${trade.id} → deposit_timeout`)
      }
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[trades] Deposit watcher error for ${trade.id}:`, msg)
    })

    console.log(`[trades] Trade ${trade.id} created — deposit address ${virtualAddress}`)
    json(res, 201, { trade_id: trade.id, virtual_deposit_address: virtualAddress, deposit_deadline: deadline })
  })

  // POST /trades/:id/payment-sent — buyer marks fiat as sent (Bearer auth, web UI path)
  router.post('/trades/:id/payment-sent', async (req, res, params) => {
    const tradeId = params['id']
    if (!tradeId) { json(res, 400, { error: 'Missing trade id' }); return }

    const parsed = PaymentSentBody.safeParse(await readJsonBody(req))
    if (!parsed.success) {
      json(res, 400, { error: parsed.error.issues[0]?.message ?? 'Invalid input' })
      return
    }

    const { buyer_address, payment_method, payment_reference, payment_proof_url } = parsed.data

    const { data: trade } = await db
      .from('trades')
      .select('buyer_address, status')
      .eq('id', tradeId)
      .single()

    if (!trade) { json(res, 404, { error: 'Trade not found' }); return }
    if (trade.buyer_address.toLowerCase() !== buyer_address.toLowerCase()) {
      json(res, 403, { error: 'Not the buyer of this trade' })
      return
    }

    try {
      await markPaymentSent(tradeId, payment_method, payment_reference, payment_proof_url)
      json(res, 200, { ok: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const code = msg.includes('not found') ? 404 : 409
      json(res, code, { error: msg })
    }
  })

  // POST /trades/:id/confirm-payment — seller confirms receipt, triggers USDC release (Bearer auth)
  router.post('/trades/:id/confirm-payment', async (req, res, params) => {
    const tradeId = params['id']
    if (!tradeId) { json(res, 400, { error: 'Missing trade id' }); return }

    const parsed = ConfirmPaymentBody.safeParse(await readJsonBody(req))
    if (!parsed.success) {
      json(res, 400, { error: parsed.error.issues[0]?.message ?? 'Invalid input' })
      return
    }

    try {
      await confirmPayment(tradeId, parsed.data.seller_address)
      json(res, 200, { ok: true, status: 'complete' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const code = msg.includes('Only the seller') ? 403
                 : msg.includes('not found')        ? 404
                 : 409
      json(res, code, { error: msg })
    }
  })

  // POST /trades/:id/cancel — mutual consent cancellation.
  //
  // First call from either party: sets status to 'cancel_requested', stores who asked.
  // Second call from the OTHER party: confirms — executes refund (if USDC deposited) and marks trade cancelled.
  // Second call from the SAME party: idempotent no-op.
  //
  // Cancellable statuses: created, deposited, payment_sent.
  // If deposited/payment_sent: USDC refunded to seller.
  // If created: no USDC involved, trade just cancelled.
  router.post('/trades/:id/cancel', async (req, res, params) => {
    const tradeId = params['id']
    if (!tradeId) { json(res, 400, { error: 'Missing trade id' }); return }

    const parsed = CancelTradeBody.safeParse(await readJsonBody(req))
    if (!parsed.success) {
      json(res, 400, { error: parsed.error.issues[0]?.message ?? 'Invalid input' })
      return
    }
    const { canceller_address } = parsed.data

    const { data: trade } = await db
      .from('trades')
      .select('id, order_id, buyer_address, seller_address, usdc_amount, status, cancel_requested_by, cancel_requested_from_status')
      .eq('id', tradeId)
      .single()

    if (!trade) { json(res, 404, { error: 'Trade not found' }); return }

    const addrLower = canceller_address.toLowerCase()
    if (
      trade.buyer_address.toLowerCase() !== addrLower &&
      trade.seller_address.toLowerCase() !== addrLower
    ) {
      json(res, 403, { error: 'Not a party to this trade' })
      return
    }

    const cancellableStatuses = ['created', 'deposited', 'payment_sent']

    // First request: move to cancel_requested
    if (cancellableStatuses.includes(trade.status)) {
      await db
        .from('trades')
        .update({
          status:                      'cancel_requested',
          cancel_requested_by:          addrLower,
          cancel_requested_from_status: trade.status,
        })
        .eq('id', tradeId)
      console.log(`[trades] Trade ${tradeId} cancel requested by ${canceller_address} (was: ${trade.status})`)
      json(res, 200, { ok: true, status: 'cancel_requested' })
      return
    }

    if (trade.status !== 'cancel_requested') {
      json(res, 409, { error: `Cannot cancel a trade with status '${trade.status}'` })
      return
    }

    // Same party re-calling: idempotent no-op
    if (trade.cancel_requested_by?.toLowerCase() === addrLower) {
      json(res, 200, { ok: true, status: 'cancel_requested' })
      return
    }

    // Other party confirms the cancellation — execute it
    const fromStatus = trade.cancel_requested_from_status ?? 'created'
    const needsRefund = ['deposited', 'payment_sent'].includes(fromStatus)

    if (needsRefund) {
      // Write refunding BEFORE transfer — crash-recoverable.
      // Order stays locked until the on-chain refund confirms so the seller's USDC
      // is never orphaned (order re-matchable while refund is in-flight).
      await updateTradeStatus(tradeId, 'refunding')
      try {
        const txHash = await transferUsdc(
          trade.seller_address as `0x${string}`,
          Number(trade.usdc_amount),
        )
        // Refund confirmed — now safe to re-open the order and close the trade.
        await db.from('orders').update({ status: 'open' }).eq('id', trade.order_id).eq('status', 'matched')
        await db.from('trades')
          .update({ status: 'refunded', cancel_requested_by: null, cancel_requested_from_status: null })
          .eq('id', tradeId)
        console.log(`[trades] Trade ${tradeId} refunded (mutual cancel) — tx ${txHash}`)
        json(res, 200, { ok: true, status: 'refunded', tx_hash: txHash })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[trades] Refund failed for ${tradeId} — trade left in refunding for manual recovery:`, msg)
        json(res, 500, { error: `Refund transfer failed: ${msg}` })
      }
    } else {
      // No USDC deposited — no transfer needed, re-open immediately.
      await db.from('orders').update({ status: 'open' }).eq('id', trade.order_id).eq('status', 'matched')
      await updateTradeStatus(tradeId, 'cancelled', { cancel_requested_by: null, cancel_requested_from_status: null })
      console.log(`[trades] Trade ${tradeId} cancelled (mutual) by ${canceller_address}`)
      json(res, 200, { ok: true, status: 'cancelled' })
    }
  })

  // POST /trades/:id/reject-cancel — the non-requesting party rejects the cancel request.
  // Reverts the trade to the status it was in before cancel_requested.
  router.post('/trades/:id/reject-cancel', async (req, res, params) => {
    const tradeId = params['id']
    if (!tradeId) { json(res, 400, { error: 'Missing trade id' }); return }

    const parsed = RejectCancelBody.safeParse(await readJsonBody(req))
    if (!parsed.success) {
      json(res, 400, { error: parsed.error.issues[0]?.message ?? 'Invalid input' })
      return
    }
    const { rejector_address } = parsed.data

    const { data: trade } = await db
      .from('trades')
      .select('id, buyer_address, seller_address, status, cancel_requested_by, cancel_requested_from_status')
      .eq('id', tradeId)
      .single()

    if (!trade) { json(res, 404, { error: 'Trade not found' }); return }
    if (trade.status !== 'cancel_requested') {
      json(res, 409, { error: 'No pending cancel request on this trade' })
      return
    }

    const addrLower = rejector_address.toLowerCase()
    if (
      trade.buyer_address.toLowerCase() !== addrLower &&
      trade.seller_address.toLowerCase() !== addrLower
    ) {
      json(res, 403, { error: 'Not a party to this trade' })
      return
    }

    if (trade.cancel_requested_by?.toLowerCase() === addrLower) {
      json(res, 400, { error: 'You cannot reject your own cancel request — use cancel to keep the request or wait for the other party' })
      return
    }

    const previousStatus = trade.cancel_requested_from_status ?? 'deposited'
    await db
      .from('trades')
      .update({
        status:                      previousStatus,
        cancel_requested_by:          null,
        cancel_requested_from_status: null,
      })
      .eq('id', tradeId)

    console.log(`[trades] Trade ${tradeId} cancel rejected by ${rejector_address} — reverted to ${previousStatus}`)
    json(res, 200, { ok: true, status: previousStatus })
  })

  // POST /trades/:id/settle — deprecated; kept for backward compat with existing agent scripts.
  // Service fee is now charged at order creation (POST /orders). This endpoint is now
  // Bearer-authed and simply marks payment_sent with method='x402'. No charge is made here.
  router.post('/trades/:id/settle', async (req, res, params) => {
    const tradeId = params['id']
    if (!tradeId) { json(res, 400, { error: 'Missing trade id' }); return }

    const { data: trade, error } = await db
      .from('trades')
      .select('id, status')
      .eq('id', tradeId)
      .single()

    if (error ?? !trade) { json(res, 404, { error: 'Trade not found' }); return }
    if (trade.status !== 'deposited') {
      json(res, 409, { error: `Trade is ${trade.status}, expected deposited` })
      return
    }

    await markPaymentSent(tradeId, 'x402', tradeId)
    json(res, 200, {
      status:    'payment_sent',
      next_step: 'Seller must confirm receipt at POST /trades/:id/confirm-payment to release USDC.',
    })
  })
}
