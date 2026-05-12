import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import type { Database } from '@/lib/database.types'

type OrderStatus = Database['public']['Enums']['order_status']
type OrderType   = Database['public']['Enums']['order_type']

export async function GET(req: NextRequest) {
  const type   = req.nextUrl.searchParams.get('type')
  const status = (req.nextUrl.searchParams.get('status') ?? 'open') as OrderStatus
  const id     = req.nextUrl.searchParams.get('id')

  const db = createServerClient()

  // Intentionally excludes: virtual_deposit_address (internal escrow detail),
  // service_fee_paid_at/tx_hash (internal audit fields), seller_payment_methods
  // (revealed only to trade parties via the trade page after matching).
  const PUBLIC_COLS = 'id, user_address, type, usdc_amount, usd_amount, rate, status, expires_at, created_at'

  if (id) {
    const { data, error } = await db.from('orders').select(PUBLIC_COLS).eq('id', id).single()
    if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(data)
  }

  let query = db.from('orders').select(PUBLIC_COLS).eq('status', status).order('created_at', { ascending: false })
  if (type && type !== 'all') query = query.eq('type', type as OrderType)
  const { data, error } = await query.limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST /api/orders — proxy to agent with transparent 402 passthrough.
// The agent's POST /orders endpoint is mppx-gated: it returns 402 if the caller
// hasn't yet paid the 0.1 USDC service fee. The browser's mppx/client intercepts
// the 402, signs and submits the payment, then retries — this proxy must relay
// all 402 headers verbatim so the handshake works end-to-end.
export async function POST(req: NextRequest) {
  const agentUrl = process.env.FACILITATOR_URL
  if (!agentUrl) {
    return NextResponse.json({ error: 'Agent not configured' }, { status: 503 })
  }

  // Forward the mppx payment credential on retry (Authorization: Payment <credential>)
  const forwardHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  const authorization = req.headers.get('authorization')
  if (authorization) forwardHeaders['authorization'] = authorization

  const body = await req.text()

  let agentRes: Response
  try {
    agentRes = await fetch(`${agentUrl}/orders`, {
      method: 'POST',
      headers: forwardHeaders,
      body,
      // Disable Next.js fetch caching — needed so 402 responses are not mangled
      cache: 'no-store',
    })
  } catch (err) {
    console.error('[POST /api/orders] fetch to agent failed:', err)
    return NextResponse.json({ error: 'Agent unreachable' }, { status: 502 })
  }

  const text = await agentRes.text()
  const resHeaders = new Headers({ 'Content-Type': 'application/json' })

  // Pass through all 402-related headers so mppx/client can parse the challenge
  for (const header of ['www-authenticate', 'x-payment-response', 'x-payment-required', 'accept-payment']) {
    try {
      const val = agentRes.headers.get(header)
      if (val) resHeaders.set(header, val)
    } catch (err) {
      console.error(`[POST /api/orders] failed to set response header ${header}:`, err)
    }
  }

  console.log(`[POST /api/orders] agent status=${agentRes.status} body_len=${text.length}`)
  return new NextResponse(text, { status: agentRes.status, headers: resHeaders })
}
