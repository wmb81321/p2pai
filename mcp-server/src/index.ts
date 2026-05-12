#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const API_URL        = process.env['P2PAI_API_URL']       ?? 'https://p2pai.xyz'
const BUYER_ADDRESS  = process.env['P2PAI_BUYER_ADDRESS'] ?? null
const SELLER_ADDRESS = process.env['P2PAI_SELLER_ADDRESS'] ?? null

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${API_URL}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    if (res.status === 402) {
      throw new Error(
        'Payment required (0.1 USDC service fee). ' +
        'This action requires mppx payment — use the p2pai web UI at p2pai.xyz ' +
        'or run the e2e script with a funded EOA wallet.',
      )
    }
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`API ${res.status}: ${text}`)
  }

  return res.json()
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

function err(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }] }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'p2pai',
  version: '2.0.0',
  description: 'p2pai — agentic P2P crypto-fiat settlement on Tempo. Direct counterparty payments.',
})

// ---------------------------------------------------------------------------
// Tool: list_orders
// ---------------------------------------------------------------------------

server.tool(
  'list_orders',
  'List open orders on the Convexo order book.',
  {
    type: z.enum(['buy', 'sell', 'all']).optional().describe("Filter by order type. Default is 'all'."),
  },
  async ({ type }) => {
    try {
      const t = type ?? 'all'
      const qs = t === 'all' ? 'status=open' : `type=${t}&status=open`
      const data = await apiFetch(`/api/orders?${qs}`)
      return ok(JSON.stringify(data, null, 2))
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  },
)

// ---------------------------------------------------------------------------
// Tool: get_trade
// ---------------------------------------------------------------------------

server.tool(
  'get_trade',
  'Get current status and details of a trade.',
  {
    trade_id: z.string().describe('The trade UUID.'),
  },
  async ({ trade_id }) => {
    try {
      const data = await apiFetch(`/api/trades/${trade_id}`)
      return ok(JSON.stringify(data, null, 2))
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  },
)

// ---------------------------------------------------------------------------
// Tool: get_my_trades
// ---------------------------------------------------------------------------

server.tool(
  'get_my_trades',
  'Get all trades for a wallet address.',
  {
    address: z
      .string()
      .optional()
      .describe('Wallet address (0x...). Defaults to CONVEXO_BUYER_ADDRESS or CONVEXO_SELLER_ADDRESS env var.'),
  },
  async ({ address }) => {
    try {
      const addr = address ?? BUYER_ADDRESS ?? SELLER_ADDRESS
      if (!addr) {
        return err('No address provided and neither CONVEXO_BUYER_ADDRESS nor CONVEXO_SELLER_ADDRESS is set.')
      }
      const data = await apiFetch(`/api/trades/by-user?address=${encodeURIComponent(addr)}`)
      return ok(JSON.stringify(data, null, 2))
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  },
)

// ---------------------------------------------------------------------------
// Tool: create_order
// ---------------------------------------------------------------------------

server.tool(
  'create_order',
  'Post a new buy or sell order to the order book.',
  {
    type:         z.enum(['buy', 'sell']).describe("Order type: 'buy' or 'sell'."),
    usdc_amount:  z.number().positive().describe('Amount of USDC to trade (minimum 5).'),
    rate:         z.number().positive().describe('Exchange rate: USD per USDC (e.g. 1.05).'),
    user_address: z
      .string()
      .optional()
      .describe('Wallet address posting the order. Defaults to CONVEXO_BUYER_ADDRESS (buy) or CONVEXO_SELLER_ADDRESS (sell).'),
  },
  async ({ type, usdc_amount, rate, user_address }) => {
    try {
      const addr =
        user_address ??
        (type === 'buy' ? BUYER_ADDRESS : SELLER_ADDRESS) ??
        BUYER_ADDRESS

      if (!addr) {
        return err(`No user_address provided and CONVEXO_${type.toUpperCase()}_ADDRESS env var is not set.`)
      }

      const data = await apiFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ user_address: addr, type, usdc_amount, rate }),
      })
      return ok(JSON.stringify(data, null, 2))
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  },
)

// ---------------------------------------------------------------------------
// Tool: match_order
// ---------------------------------------------------------------------------

server.tool(
  'match_order',
  'Match an existing open order to create a trade. Returns trade_id, virtual_deposit_address, and deposit_deadline.',
  {
    order_id:       z.string().describe('ID of the open order to match.'),
    buyer_address:  z.string().optional().describe('Buyer wallet address. Defaults to CONVEXO_BUYER_ADDRESS.'),
    seller_address: z.string().optional().describe('Seller wallet address. Defaults to CONVEXO_SELLER_ADDRESS.'),
  },
  async ({ order_id, buyer_address, seller_address }) => {
    try {
      const orderData = await apiFetch(`/api/orders?id=${encodeURIComponent(order_id)}`)
      const order = orderData as {
        id: string
        type: string
        usdc_amount: number
        usd_amount: number
        user_address: string
        status: string
      }

      if (order.status !== 'open') {
        return err(`Order ${order_id} is not open (status: ${order.status}).`)
      }

      let resolvedBuyer: string
      let resolvedSeller: string

      if (order.type === 'buy') {
        const resolved = seller_address ?? SELLER_ADDRESS
        if (!resolved) {
          return err('Matching a BUY order requires a seller address. Provide seller_address or set CONVEXO_SELLER_ADDRESS.')
        }
        resolvedBuyer  = order.user_address
        resolvedSeller = resolved
      } else {
        const resolved = buyer_address ?? BUYER_ADDRESS
        if (!resolved) {
          return err('Matching a SELL order requires a buyer address. Provide buyer_address or set CONVEXO_BUYER_ADDRESS.')
        }
        resolvedSeller = order.user_address
        resolvedBuyer  = resolved
      }

      const data = await apiFetch('/api/trades', {
        method: 'POST',
        body: JSON.stringify({
          order_id:       order.id,
          buyer_address:  resolvedBuyer,
          seller_address: resolvedSeller,
          usdc_amount:    order.usdc_amount,
          usd_amount:     order.usd_amount,
        }),
      })

      return ok(JSON.stringify(data, null, 2))
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  },
)

// ---------------------------------------------------------------------------
// Tool: mark_payment_sent
// ---------------------------------------------------------------------------

server.tool(
  'mark_payment_sent',
  'Buyer marks fiat payment as sent. Call after deposited state. Provide method (e.g. Zelle), reference number, and optional proof URL.',
  {
    trade_id:          z.string().describe('The trade UUID.'),
    payment_method:    z.string().describe('Payment method used (e.g. Zelle, Venmo, Bank Transfer).'),
    payment_reference: z.string().describe('Confirmation number or transaction reference.'),
    payment_proof_url: z.string().url().optional().describe('URL to screenshot or proof of payment (optional).'),
    buyer_address:     z.string().optional().describe('Buyer wallet address. Defaults to CONVEXO_BUYER_ADDRESS.'),
  },
  async ({ trade_id, payment_method, payment_reference, payment_proof_url, buyer_address }) => {
    try {
      const addr = buyer_address ?? BUYER_ADDRESS
      if (!addr) {
        return err('No buyer_address provided and CONVEXO_BUYER_ADDRESS is not set.')
      }

      const body: Record<string, string> = {
        buyer_address:     addr,
        payment_method,
        payment_reference,
      }
      if (payment_proof_url) body['payment_proof_url'] = payment_proof_url

      const data = await apiFetch(`/api/trades/${trade_id}/payment-sent`, {
        method: 'POST',
        body: JSON.stringify(body),
      })

      return ok(JSON.stringify({
        ...data as object,
        next_step: 'Seller must confirm receipt. Call confirm_payment once the seller verifies they received the funds.',
      }, null, 2))
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  },
)

// ---------------------------------------------------------------------------
// Tool: confirm_payment
// ---------------------------------------------------------------------------

server.tool(
  'confirm_payment',
  'Seller confirms they received the fiat payment. Triggers on-chain USDC release to buyer. This is irreversible.',
  {
    trade_id:       z.string().describe('The trade UUID.'),
    seller_address: z.string().optional().describe('Seller wallet address. Defaults to CONVEXO_SELLER_ADDRESS.'),
  },
  async ({ trade_id, seller_address }) => {
    try {
      const addr = seller_address ?? SELLER_ADDRESS
      if (!addr) {
        return err('No seller_address provided and CONVEXO_SELLER_ADDRESS is not set.')
      }

      const data = await apiFetch(`/api/trades/${trade_id}/confirm-payment`, {
        method: 'POST',
        body: JSON.stringify({ seller_address: addr }),
      })

      return ok(JSON.stringify({
        ...data as object,
        message: 'Payment confirmed. USDC is being released on-chain to the buyer.',
      }, null, 2))
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  },
)

// ---------------------------------------------------------------------------
// Tool: settle_trade (x402 / mppx path for autonomous agents)
// ---------------------------------------------------------------------------

server.tool(
  'settle_trade',
  'Pay the 0.1 USDC service fee via x402/MPP to mark payment as sent (agent-native path). Use this instead of mark_payment_sent when operating as an autonomous buyer agent that pays via on-chain x402.',
  {
    trade_id: z.string().describe('The trade UUID to settle.'),
  },
  async ({ trade_id }) => {
    try {
      const data = await apiFetch(`/api/trades/${trade_id}/settle`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      const result = data as { status?: string; error?: string; next_step?: string }

      if (result.error) return err(result.error)

      return ok(JSON.stringify({
        trade_id,
        status:    result.status ?? 'payment_sent',
        next_step: result.next_step ?? 'Seller must confirm receipt via confirm_payment.',
      }, null, 2))
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  },
)

// ---------------------------------------------------------------------------
// Tool: get_trade_status_description
// ---------------------------------------------------------------------------

server.tool(
  'get_trade_status_description',
  'Get a human-readable description of what needs to happen next in a trade.',
  {
    trade_id: z.string().describe('The trade UUID.'),
  },
  async ({ trade_id }) => {
    try {
      const data = await apiFetch(`/api/trades/${trade_id}`)
      const trade = data as {
        status:                  string
        usdc_amount:             number
        usd_amount:              number
        virtual_deposit_address: string | null
        buyer_address:           string | null
        seller_address:          string | null
        payment_method:          string | null
        payment_reference:       string | null
      }

      const { status, usdc_amount, usd_amount, virtual_deposit_address } = trade

      const descriptions: Record<string, string> = {
        created:
          virtual_deposit_address
            ? `Seller needs to deposit ${usdc_amount} USDC to ${virtual_deposit_address} within 30 minutes.`
            : `Trade created. Waiting for deposit address.`,
        deposited:
          `USDC deposited. Buyer needs to send $${usd_amount} USD to the seller via their preferred payment method, then call mark_payment_sent.`,
        payment_sent:
          `Buyer marked payment as sent${trade.payment_method ? ` via ${trade.payment_method}` : ''}. Seller needs to verify receipt and call confirm_payment.`,
        payment_confirmed:
          `Payment confirmed. USDC is being released on-chain to the buyer.`,
        released:
          `USDC released to buyer. Trade complete. Both parties can now rate each other.`,
        complete:
          `Trade finished successfully.`,
        deposit_timeout:
          `Trade expired — seller did not deposit within 30 minutes.`,
        disputed:
          `Trade is under dispute.`,
        refunded:
          `Trade was refunded.`,
      }

      const description = descriptions[status] ?? `Trade is in state: ${status}`

      return ok(JSON.stringify({
        trade_id,
        status,
        description,
        usdc_amount,
        usd_amount,
        virtual_deposit_address: virtual_deposit_address ?? null,
        buyer_address:           trade.buyer_address  ?? null,
        seller_address:          trade.seller_address ?? null,
        payment_method:          trade.payment_method ?? null,
        payment_reference:       trade.payment_reference ?? null,
      }, null, 2))
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  },
)

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport()
await server.connect(transport)
