export const dynamic = 'force-static'

// Full p2pai API reference — served as plain text for LLM consumption.
// Keep in sync with docs/agent-api.md.
const CONTENT = `# p2pai — Agent API Reference (v2.3.0)

Frontend: https://p2pai.xyz
Agent base URL: https://convexo-p2p-agent-production.up.railway.app
Frontend proxy: https://p2pai.xyz/api/* (same contracts, passes 402 through)

Agent setup (Claude Code): claude -p "Read https://p2pai.xyz/SKILL.md and set up p2pai. My wallet address is 0x<addr>"
Short index: https://p2pai.xyz/llms.txt

All POST bodies are Content-Type: application/json. All responses are JSON.

---

## Authentication model

POST /orders                  mppx x402 — 402 challenge → pay 0.1 USDC → proceeds
POST /trades                  mppx x402 — 402 challenge → pay 0.1 USDC → proceeds
POST /orders/:id/cancel       address-in-body — user_address must match order.user_address
POST /trades/:id/payment-sent address-in-body — buyer_address must match trade.buyer_address
POST /trades/:id/confirm-payment address-in-body — seller_address must match trade.seller_address
POST /trades/:id/cancel       address-in-body — canceller_address must be buyer or seller
POST /trades/:id/reject-cancel address-in-body — rejector_address must be non-requester party
POST /trades/:id/settle       Bearer — Authorization: Bearer <AGENT_API_KEY> (deprecated)
GET  /health                  public
GET  /api/orders              public (read-only)

mppx x402: endpoint returns HTTP 402 with WWW-Authenticate challenge. Client pays 0.1 USDC
via mppx and retries. Use mppx/client with mode: 'push' for Tempo passkey wallets.

---

## Trade state machine

created
  ↓  seller deposits USDC to virtual address → Transfer event detected
deposited
  ↓  buyer calls POST /trades/:id/payment-sent
payment_sent
  ↓  seller calls POST /trades/:id/confirm-payment → USDC transferred on-chain
payment_confirmed → released → complete

Cancel paths (from created, deposited, or payment_sent):
  first party calls POST /trades/:id/cancel
cancel_requested
  ↓  other party calls POST /trades/:id/cancel
    → no deposit:   cancelled        (order reopened)
    → deposited:    refunding → refunded  (USDC returned to seller on-chain; order reopened)
  ↓  other party calls POST /trades/:id/reject-cancel
    → reverts to cancel_requested_from_status (trade continues)

Terminal failure states:
  deposit_timeout  — 30 min without deposit
  disputed         — opened by support
  cancelled        — mutual cancel, no deposit
  refunded         — mutual cancel, USDC returned

---

## Endpoints

### GET /health
No auth. Response 200: { "status": "ok", "version": "2.3.0" }
Also available at: https://convexo-p2p-agent-production.up.railway.app/health

---

### POST /orders
Pay 0.1 USDC maker fee → create SELL or BUY order with per-order virtual deposit address.
Auth: mppx x402. externalId = orderId (idempotent retries).

Request:
{
  "user_address":    "0x<40-hex>",          required
  "type":            "sell" | "buy",         required
  "usdc_amount":     5.0,                    required, min 5
  "rate":            1.05,                   required, USD per USDC
  "payment_methods": [                       optional, max 10
    { "type": "zelle", "label": "Zelle", "value": "+1-555-0100" }
  ]
}

usd_amount computed server-side as round(usdc_amount × rate, 2).

Response 200:
{
  "id": "ord_uuid",
  "user_address": "0x...",
  "type": "sell",
  "usdc_amount": 100.0,
  "usd_amount": 105.0,
  "rate": 1.05,
  "status": "open",
  "virtual_deposit_address": "0x...",
  "service_fee_paid_at": "2026-05-03T12:00:00.000Z",
  "seller_payment_methods": [...],
  "expires_at": "2026-05-04T12:00:00.000Z",
  "created_at": "2026-05-03T12:00:00.000Z"
}

Errors:
  402  mppx challenge — fee not yet paid
  400  { "error": "Minimum order is 5 USDC" }
  500  { "error": "Order creation failed after payment", "order_id": "..." }

Note: 0.1 USDC fee is forfeited on cancel or expiry.

---

### POST /orders/:id/cancel
Cancel open order. Only creator can cancel. Fee forfeited.
Auth: user_address in body verified against order.user_address (case-insensitive).

Request: { "user_address": "0x<40-hex>" }
Response 200: { "message": "Order cancelled" }

Errors:
  404  { "error": "Order not found" }
  403  { "error": "Not authorized to cancel this order" }
  409  { "error": "Order is not open" }

---

### POST /trades
Pay 0.1 USDC taker fee → match open order, create trade.
Auth: mppx x402. externalId = "taker_<buyer_address>_<order_id>" (idempotent retries).

Request:
{
  "order_id":       "ord_uuid",
  "buyer_address":  "0x<40-hex>",
  "seller_address": "0x<40-hex>",
  "usdc_amount":    100.0,
  "usd_amount":     105.0
}

Role assignment: for SELL orders, matcher is buyer; for BUY orders, matcher is seller.

Response 200:
{
  "trade_id": "trd_uuid",
  "virtual_deposit_address": "0x...",
  "deposit_deadline": "2026-05-03T12:30:00.000Z",
  "seller_payment_methods": [...]
}

Starts 30-minute deposit timer. No deposit → deposit_timeout.

Errors:
  402  mppx challenge — taker fee not yet paid
  409  { "error": "Order is no longer available" }
  409  { "error": "Order has no deposit address — cancel and re-create" }

---

### POST /trades/:id/payment-sent
Buyer marks fiat sent → trade transitions to payment_sent.
Auth: buyer_address in body verified against trade.buyer_address (case-insensitive).

Request:
{
  "buyer_address":     "0x<40-hex>",       required
  "payment_method":    "zelle",             required, 1-50 chars
  "payment_reference": "Conf #123456",      required, 1-200 chars
  "payment_proof_url": "https://..."        optional
}

Response 200: { "status": "payment_sent" }
Idempotent: re-calling when already payment_sent is a no-op.

Errors:
  404  { "error": "Trade not found" }
  403  { "error": "Only the buyer can mark payment as sent" }
  409  { "error": "Trade is not in a state where payment can be marked as sent" }

---

### POST /trades/:id/confirm-payment
Seller confirms fiat received → USDC released on-chain → payment_confirmed → released → complete.
Auth: seller_address in body verified against trade.seller_address (case-insensitive).
THIS IS THE TRUST ANCHOR — only the seller can release USDC.

Request: { "seller_address": "0x<40-hex>" }
Response 200: { "status": "complete", "tx_hash": "0x..." }
Idempotent: re-calling when already released/complete is a no-op.

Errors:
  404  { "error": "Trade not found" }
  403  { "error": "Only the seller can confirm payment receipt" }
  409  { "error": "Trade is not in a state where payment can be confirmed" }
  500  { "error": "USDC transfer failed: ..." }

---

### POST /trades/:id/cancel
Mutual cancellation. Either party calls. Behavior depends on current state.
Auth: canceller_address must be trade buyer or seller.

Request: { "canceller_address": "0x<40-hex>" }

Behavior:
  First call (created/deposited/payment_sent) → cancel_requested
    stores cancel_requested_by + cancel_requested_from_status
  Same party calls again → no-op (idempotent)
  Other party calls → no deposit:  cancelled (order reopened)
                    → deposited:   refunding → refunded + tx_hash (order reopened)

Response 200 examples:
  { "status": "cancel_requested", "message": "Cancel requested — waiting for counterparty..." }
  { "status": "cancelled", "message": "Trade cancelled" }
  { "status": "refunded", "message": "Trade cancelled and USDC refunded to seller", "tx_hash": "0x..." }

Errors:
  404  { "error": "Trade not found" }
  403  { "error": "Not a party to this trade" }
  409  { "error": "Trade cannot be cancelled in its current state" }

---

### POST /trades/:id/reject-cancel
Non-requesting party rejects cancel → trade reverts to cancel_requested_from_status.
Auth: rejector_address must be party who did NOT request cancel.

Request: { "rejector_address": "0x<40-hex>" }
Response 200: { "status": "<cancel_requested_from_status>", "message": "Cancel request rejected — trade continues" }

Errors:
  404  { "error": "Trade not found" }
  403  { "error": "Not a party to this trade" }
  403  { "error": "Only the non-requesting party can reject a cancel" }
  409  { "error": "Trade is not in cancel_requested state" }

---

### POST /trades/:id/settle (deprecated)
Marks payment_sent with method='x402'. Does NOT release USDC.
Auth: Bearer token. No fee charged.
Use /trades/:id/payment-sent for new integrations.

Request: {}
Response 200: { "status": "payment_sent" }

---

### GET /api/orders
Public order book.
Query params: type=buy|sell, status=open|matched|cancelled|expired, id=<uuid>
Response 200: array of order objects (or single object with ?id=)

---

## mppx client setup

import { Mppx, tempo } from 'mppx/client'

const mppx = Mppx.create({
  methods: [tempo.charge({ getClient: () => walletClient, mode: 'push' })],
  polyfill: false,
})

// mode: 'push' is REQUIRED for Tempo passkey wallets.
// Pull mode produces ECDSA-incompatible signatures that Revm cannot verify.

const res = await mppx.fetch('/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_address, type, usdc_amount, rate }),
})

---

## Full trade walkthrough (agent POV)

# 1. Post a SELL order (maker fee via mppx)
POST /orders → 402 → pay 0.1 USDC → retry → 200 { id, virtual_deposit_address }

# 2. Match as buyer (taker fee via mppx)
POST /trades → 402 → pay 0.1 USDC → retry → 200 { trade_id, virtual_deposit_address }

# 3. Seller deposits USDC to virtual_deposit_address
# NOT a REST call — use Tempo wallet or Hooks.token.useTransferSync
# Agent detects Transfer event → status: deposited

# 4. Buyer marks fiat sent
POST /trades/:id/payment-sent
  body: { buyer_address, payment_method, payment_reference }
  → 200 { status: "payment_sent" }

# 5. Seller confirms → USDC released
POST /trades/:id/confirm-payment
  body: { seller_address }
  → 200 { status: "complete", tx_hash }

---

## Image proof upload

POST /api/upload-proof (frontend proxy only, not agent route)
Content-Type: multipart/form-data, field: file=<image>
Max 5 MB, images only.
Response 200: { "url": "https://..." }
Pass url as payment_proof_url in /payment-sent.

---

## MCP server (p2pai-mcp)

npx p2pai-mcp

env:
  P2PAI_API_URL:        https://p2pai.xyz
  P2PAI_BUYER_ADDRESS:  0x<your-wallet>
  P2PAI_SELLER_ADDRESS: 0x<your-wallet>

Tools:
  list_orders              → GET /api/orders
  get_trade                → GET /api/trades/:id
  get_my_trades            → GET /api/trades/by-user
  create_order             → POST /api/orders
  match_order              → POST /api/trades
  mark_payment_sent        → POST /api/trades/:id/payment-sent
  confirm_payment          → POST /api/trades/:id/confirm-payment
  get_trade_status_description → synthesized from GET /api/trades/:id

---

## Key constraints

- Virtual addresses always read zero from balanceOf — watch Transfer events only
- mode: 'push' is required for Tempo passkey wallets (mppx client)
- externalId prevents double-charging: orderId for maker, taker_<buyer>_<orderId> for taker
- Supabase state written BEFORE every on-chain side-effect
- Service-role Supabase key is server-only — never in browser bundles
- USDC releases only after seller calls confirm-payment — never bypass this
`

export function GET() {
  return new Response(CONTENT, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
