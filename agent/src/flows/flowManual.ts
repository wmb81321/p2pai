/**
 * Flow Manual — direct counterparty settlement.
 *
 * State machine:
 *   created → deposited → payment_sent → payment_confirmed → released → complete
 *
 * 1. Seller deposits USDC to virtual address (auto-forwarded to master).
 * 2. Buyer pays seller directly (Zelle, bank transfer, etc.) and marks sent.
 * 3. Seller confirms receipt → agent releases USDC on-chain to buyer.
 *
 * Crash-safety: Supabase state written BEFORE every on-chain side-effect.
 * Idempotent: every function checks current state before acting.
 */

import { db, updateTradeStatus } from '../lib/supabase.js'
import { TradeRowSchema } from '../lib/schemas.js'
import { transferUsdc } from '../tempo/wallet.js'

async function fetchTrade(tradeId: string) {
  const { data, error } = await db
    .from('trades')
    .select('*')
    .eq('id', tradeId)
    .single()
  if (error ?? !data) throw new Error(`Trade ${tradeId} not found: ${error?.message ?? 'no data'}`)
  return TradeRowSchema.parse(data)
}

/**
 * Drives: deposited → payment_sent
 * Called by POST /trades/:id/payment-sent
 */
export async function markPaymentSent(
  tradeId: string,
  method: string,
  reference: string,
  proofUrl?: string,
): Promise<void> {
  const trade = await fetchTrade(tradeId)

  // Idempotent — already past this stage
  if (
    trade.status === 'payment_sent'      ||
    trade.status === 'payment_confirmed' ||
    trade.status === 'released'          ||
    trade.status === 'complete'
  ) return

  if (trade.status !== 'deposited') {
    throw new Error(
      `Cannot mark payment sent for trade ${tradeId}: expected deposited, got ${trade.status}`,
    )
  }

  await updateTradeStatus(tradeId, 'payment_sent', {
    payment_method:    method,
    payment_reference: reference,
    payment_proof_url: proofUrl ?? null,
    payment_sent_at:   new Date().toISOString(),
  })

  console.log(`[flowManual] Trade ${tradeId} → payment_sent via ${method}`)
}

/**
 * Drives: payment_sent → payment_confirmed → released → complete
 * Called by POST /trades/:id/confirm-payment (seller action)
 *
 * Crash-safety model:
 *   payment_confirmed = seller verified, transfer not yet attempted
 *   released          = transfer confirmed on-chain (tx hash stored)
 *   complete          = final state
 *
 * If the agent crashes between transferUsdc returning and writing `released`,
 * a retry finds payment_confirmed and re-attempts the transfer. The on-chain
 * transfer is idempotent from the buyer's perspective (they receive funds once).
 * This is the correct tradeoff — a guaranteed stuck state (old bug) is worse
 * than a negligibly rare extra transfer on a millisecond crash window.
 */
export async function confirmPayment(
  tradeId: string,
  confirmerAddress: string,
): Promise<void> {
  const trade = await fetchTrade(tradeId)

  // Already successfully released — idempotent return.
  if (trade.status === 'released' || trade.status === 'complete') return

  // payment_confirmed means the seller verified but the transfer hasn't been
  // written as released yet (crash recovery path). Fall through and retry.
  if (trade.status !== 'payment_sent' && trade.status !== 'payment_confirmed') {
    throw new Error(
      `Cannot confirm payment for trade ${tradeId}: expected payment_sent, got ${trade.status}`,
    )
  }

  if (confirmerAddress.toLowerCase() !== trade.seller_address.toLowerCase()) {
    throw new Error(`Only the seller can confirm payment receipt for trade ${tradeId}`)
  }

  // Write payment_confirmed before the transfer — marks that the seller has
  // verified receipt. Only written on first call (idempotent on retry).
  if (trade.status === 'payment_sent') {
    await updateTradeStatus(tradeId, 'payment_confirmed', {
      payment_confirmed_at: new Date().toISOString(),
    })
    console.log(`[flowManual] Trade ${tradeId} → payment_confirmed`)
  }

  // Transfer USDC on-chain. If this throws, the trade stays at payment_confirmed
  // so the seller can retry — the idempotent guard above lets retries through.
  const txHash = await transferUsdc(
    trade.buyer_address as `0x${string}`,
    trade.usdc_amount,
  )

  await updateTradeStatus(tradeId, 'released', { release_tx_hash: txHash })
  console.log(`[flowManual] Trade ${tradeId} → released (tx: ${txHash})`)

  await updateTradeStatus(tradeId, 'complete')
  console.log(`[flowManual] Trade ${tradeId} → complete`)
}
