# p2pai — Agent API Reference (v2.3.0)

**Base URL:** `https://convexo-p2p-agent-production.up.railway.app`  
**Frontend proxy:** `https://p2pai.xyz/api/*` (same contracts, passes 402 through)

All POST bodies are `Content-Type: application/json`. All responses are JSON.

---

## Authentication model

| Route | Auth mechanism |
|---|---|
| `POST /orders` | **mppx x402** — 402 challenge → pay 0.1 USDC → request proceeds |
| `POST /trades` | **mppx x402** — 402 challenge → pay 0.1 USDC → request proceeds |
| `POST /orders/:id/cancel` | **Address-in-body** — `user_address` must match `order.user_address` |
| `POST /trades/:id/payment-sent` | **Address-in-body** — `buyer_address` must match `trade.buyer_address` |
| `POST /trades/:id/confirm-payment` | **Address-in-body** — `seller_address` must match `trade.seller_address` |
| `POST /trades/:id/cancel` | **Address-in-body** — `canceller_address` must be buyer or seller of the trade |
| `POST /trades/:id/reject-cancel` | **Address-in-body** — `rejector_address` must be the non-requester party |
| `POST /trades/:id/settle` | **Bearer** — `Authorization: Bearer <AGENT_API_KEY>` (deprecated) |
| `GET /health` | Public |
| `GET /api/orders` | Public (read-only) |

> **mppx x402:** The endpoint returns `HTTP 402` with a `WWW-Authenticate` challenge. The client pays 0.1 USDC via `mppx` and retries — the retry with valid payment proceeds normally. Use `mppx/client` with `mode: 'push'` for Tempo passkey wallets.

---

## Trade state machine

```
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
```

---

## Endpoints

### GET /health

Returns agent version and uptime. No auth.

**Response 200:**
```json
{ "status": "ok", "version": "2.2.0" }
```

---

### POST /orders

Pay 0.1 USDC maker fee → create a new SELL or BUY order with a per-order virtual deposit address.

**Auth:** mppx x402 (0.1 USDC). `externalId = orderId` — retries are idempotent.

**Request:**
```json
{
  "user_address":    "0x<40-hex>",
  "type":            "sell" | "buy",
  "usdc_amount":     5.0,
  "rate":            1.05,
  "payment_methods": [
    { "type": "zelle", "label": "Zelle", "value": "+1-555-0100" }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `user_address` | yes | Order creator's wallet |
| `type` | yes | `"sell"` (has USDC, wants USD) or `"buy"` (has USD, wants USDC) |
| `usdc_amount` | yes | Minimum 5 USDC |
| `rate` | yes | USD per USDC, must be positive |
| `payment_methods` | no | Array of up to 10 methods; required for SELL orders so buyers know how to pay |

`usd_amount` is computed server-side as `round(usdc_amount × rate, 2)`.

**Response 200:**
```json
{
  "id":                      "ord_uuid",
  "user_address":            "0x...",
  "type":                    "sell",
  "usdc_amount":             100.0,
  "usd_amount":              105.0,
  "rate":                    1.05,
  "status":                  "open",
  "virtual_deposit_address": "0x...",
  "service_fee_paid_at":     "2026-05-03T12:00:00.000Z",
  "seller_payment_methods":  [...],
  "expires_at":              "2026-05-04T12:00:00.000Z",
  "created_at":              "2026-05-03T12:00:00.000Z"
}
```

**Errors:**

| Status | Body | Meaning |
|---|---|---|
| 402 | mppx challenge | Fee not yet paid |
| 400 | `{ "error": "Minimum order is 5 USDC" }` | Validation failure |
| 500 | `{ "error": "Order creation failed after payment", "order_id": "..." }` | DB error post-payment — contact support |

> **Service fee note:** The 0.1 USDC fee is forfeited if the order is cancelled or expires unmatched. It is NOT refunded by mppx.

---

### POST /orders/:id/cancel

Cancel an open order. Only the order creator can cancel. The service fee is forfeited.

**Auth:** Address-in-body (`user_address` verified against `order.user_address`, case-insensitive).

**Request:**
```json
{ "user_address": "0x<40-hex>" }
```

**Response 200:**
```json
{ "message": "Order cancelled" }
```

**Errors:**

| Status | Body | Meaning |
|---|---|---|
| 404 | `{ "error": "Order not found" }` | Unknown order ID |
| 403 | `{ "error": "Not authorized to cancel this order" }` | Address mismatch |
| 409 | `{ "error": "Order is not open" }` | Already matched/cancelled/expired |

---

### POST /trades

Pay 0.1 USDC taker fee → match an open order and create a trade.

**Auth:** mppx x402 (0.1 USDC). `externalId = "taker_<buyer_address>_<order_id>"` — retries are idempotent.

**Request:**
```json
{
  "order_id":       "ord_uuid",
  "buyer_address":  "0x<40-hex>",
  "seller_address": "0x<40-hex>",
  "usdc_amount":    100.0,
  "usd_amount":     105.0
}
```

| Field | Notes |
|---|---|
| `buyer_address` | For SELL orders: taker (matcher). For BUY orders: order creator. |
| `seller_address` | For SELL orders: order creator. For BUY orders: taker (matcher). |
| `usdc_amount` / `usd_amount` | Must match the order's amounts |

> **Role assignment:** The frontend derives roles from `order.type`. If `order.type === 'sell'`, the matcher is the buyer; if `order.type === 'buy'`, the matcher is the seller.

**Response 200:**
```json
{
  "trade_id":               "trd_uuid",
  "virtual_deposit_address": "0x...",
  "deposit_deadline":        "2026-05-03T12:30:00.000Z",
  "seller_payment_methods":  [...]
}
```

Starts a 30-minute deposit timer. If no deposit is detected within 30 minutes, the trade moves to `deposit_timeout`.

**Errors:**

| Status | Body | Meaning |
|---|---|---|
| 402 | mppx challenge | Taker fee not yet paid |
| 409 | `{ "error": "Order is no longer available" }` | Order already matched |
| 409 | `{ "error": "Order has no deposit address — cancel and re-create" }` | Pre-v2.1 legacy order |

---

### POST /trades/:id/payment-sent

Buyer marks fiat as sent to the seller. Transitions trade to `payment_sent`.

**Auth:** Address-in-body (`buyer_address` verified against `trade.buyer_address`, case-insensitive).

**Request:**
```json
{
  "buyer_address":     "0x<40-hex>",
  "payment_method":    "zelle",
  "payment_reference": "Conf #123456",
  "payment_proof_url": "https://storage.supabase.co/..."
}
```

| Field | Required | Notes |
|---|---|---|
| `buyer_address` | yes | Must match trade's buyer |
| `payment_method` | yes | 1–50 chars (e.g. `"zelle"`, `"venmo"`, `"bank"`, `"wire"`) |
| `payment_reference` | yes | 1–200 chars — confirmation number, reference ID, etc. |
| `payment_proof_url` | no | URL to payment screenshot; upload via `/api/upload-proof` first |

**Response 200:**
```json
{ "status": "payment_sent" }
```

**Errors:**

| Status | Body | Meaning |
|---|---|---|
| 404 | `{ "error": "Trade not found" }` | Unknown trade ID |
| 403 | `{ "error": "Only the buyer can mark payment as sent" }` | Address mismatch |
| 409 | `{ "error": "Trade is not in a state where payment can be marked as sent" }` | Wrong status |

> Idempotent: re-calling when already `payment_sent` is a no-op.

---

### POST /trades/:id/confirm-payment

Seller confirms fiat received → agent releases USDC on-chain to buyer. Transitions `payment_sent → payment_confirmed → released → complete`.

**Auth:** Address-in-body (`seller_address` verified against `trade.seller_address`, case-insensitive). This is the trust anchor — only the seller can release USDC.

**Request:**
```json
{ "seller_address": "0x<40-hex>" }
```

**Response 200:**
```json
{ "status": "complete", "tx_hash": "0x..." }
```

**Errors:**

| Status | Body | Meaning |
|---|---|---|
| 404 | `{ "error": "Trade not found" }` | Unknown trade ID |
| 403 | `{ "error": "Only the seller can confirm payment receipt" }` | Address mismatch |
| 409 | `{ "error": "Trade is not in a state where payment can be confirmed" }` | Wrong status |
| 500 | `{ "error": "USDC transfer failed: ..." }` | On-chain TX failed |

> Idempotent: re-calling when already `released`/`complete` is a no-op (no second transfer).

---

### POST /trades/:id/cancel

Mutual cancellation. Either party calls this endpoint. Behavior depends on current state:

**Auth:** Address-in-body (`canceller_address` must be the trade's `buyer_address` or `seller_address`).

**Request:**
```json
{ "canceller_address": "0x<40-hex>" }
```

**Behavior:**

| Situation | Result |
|---|---|
| First call (trade is `created`, `deposited`, or `payment_sent`) | Trade → `cancel_requested`. Stores `cancel_requested_by` and `cancel_requested_from_status`. |
| Second call from the **same** party | No-op (idempotent). |
| Second call from the **other** party + no deposit | Trade → `cancelled`. Order reopened to `open`. |
| Second call from the **other** party + USDC was deposited | Trade → `refunding` → `refunded` (USDC returned to seller on-chain). Order reopened to `open`. |

**Response 200:**
```json
{
  "status": "cancel_requested",
  "message": "Cancel requested — waiting for counterparty to confirm or reject"
}
```
or
```json
{
  "status": "cancelled",
  "message": "Trade cancelled"
}
```
or
```json
{
  "status": "refunded",
  "message": "Trade cancelled and USDC refunded to seller",
  "tx_hash": "0x..."
}
```

**Errors:**

| Status | Body | Meaning |
|---|---|---|
| 404 | `{ "error": "Trade not found" }` | Unknown trade ID |
| 403 | `{ "error": "Not a party to this trade" }` | Address not buyer or seller |
| 409 | `{ "error": "Trade cannot be cancelled in its current state" }` | Status is `payment_confirmed`, `released`, `complete`, or already terminal |

---

### POST /trades/:id/reject-cancel

Non-requesting party rejects the cancellation. Trade reverts to its state before `cancel_requested`.

**Auth:** Address-in-body (`rejector_address` must be the party who did NOT request the cancel).

**Request:**
```json
{ "rejector_address": "0x<40-hex>" }
```

**Response 200:**
```json
{
  "status": "deposited",
  "message": "Cancel request rejected — trade continues"
}
```
(Status in response reflects `cancel_requested_from_status`, e.g. `created`, `deposited`, or `payment_sent`.)

**Errors:**

| Status | Body | Meaning |
|---|---|---|
| 404 | `{ "error": "Trade not found" }` | Unknown trade ID |
| 403 | `{ "error": "Not a party to this trade" }` | Address not buyer or seller |
| 403 | `{ "error": "Only the non-requesting party can reject a cancel" }` | Requester trying to reject their own request |
| 409 | `{ "error": "Trade is not in cancel_requested state" }` | Wrong status |

---

### POST /trades/:id/settle *(deprecated)*

Marks a trade as `payment_sent` with `method='x402'`. Does **not** release USDC — the seller still needs to call `confirm-payment`.

**Auth:** `Authorization: Bearer <AGENT_API_KEY>` (no fee charged at this endpoint; fee was removed in v2.1.0).

**Request:** empty body or `{}`

**Response 200:**
```json
{ "status": "payment_sent" }
```

> **Use `/trades/:id/payment-sent` for new integrations.** This endpoint exists for backward compatibility with autonomous agents that used the old x402-settle path.

---

### GET /api/orders

Public read endpoint for the order book.

**Query params:**

| Param | Values | Notes |
|---|---|---|
| `type` | `buy` \| `sell` | Filter by order type |
| `status` | `open` \| `matched` \| `cancelled` \| `expired` | Default: `open` |
| `id` | UUID | Fetch a single order by ID |

**Response 200:** Array of order objects (or single object when `?id=` is used).

---

## mppx client setup (frontend / agent)

```ts
import { Mppx, tempo } from 'mppx/client'

const mppx = Mppx.create({
  methods: [tempo.charge({
    getClient: () => walletClient,
    mode: 'push',           // required for Tempo passkey wallets
  })],
  polyfill: false,
})

// Place order — pays maker fee automatically on 402 response
const res = await mppx.fetch('/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_address, type, usdc_amount, rate }),
})

// Match order — pays taker fee automatically on 402 response
const res2 = await mppx.fetch('/api/trades', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ order_id, buyer_address, seller_address, usdc_amount, usd_amount }),
})
```

> **`mode: 'push'` is required.** Tempo passkey wallets attach a `feePayerSignature` that pull mode (`signTransaction`) cannot produce correctly. Push mode uses `wallet_sendCalls` and passes the full broadcast to the wallet.

---

## Full trade walkthrough (agent POV)

```bash
# 1. Post a SELL order (maker fee via mppx)
POST /orders
  → 402 challenge → pay 0.1 USDC → retry
  → 200 { id, virtual_deposit_address, ... }

# 2. Match the order as buyer (taker fee via mppx)
POST /trades
  → 402 challenge → pay 0.1 USDC → retry
  → 200 { trade_id, virtual_deposit_address, deposit_deadline }

# 3. Seller deposits USDC to virtual_deposit_address
#    (via Tempo wallet or Hooks.token.useTransferSync — NOT a REST call)
#    → agent detects Transfer event → status: deposited

# 4. Buyer marks payment sent
POST /trades/:id/payment-sent
  body: { buyer_address, payment_method, payment_reference }
  → 200 { status: "payment_sent" }

# 5. Seller confirms receipt → USDC released on-chain
POST /trades/:id/confirm-payment
  body: { seller_address }
  → 200 { status: "complete", tx_hash }

# ── Cancel path (alternative from steps 2–4) ────────────────

# Either party requests cancel
POST /trades/:id/cancel
  body: { canceller_address }
  → 200 { status: "cancel_requested" }

# Other party confirms (with deposit)
POST /trades/:id/cancel
  body: { canceller_address: otherPartyAddress }
  → 200 { status: "refunded", tx_hash }

# OR — other party rejects, trade continues
POST /trades/:id/reject-cancel
  body: { rejector_address: otherPartyAddress }
  → 200 { status: "deposited" }
```

---

## Image proof upload

Before calling `/trades/:id/payment-sent`, buyers can upload a payment screenshot:

```
POST /api/upload-proof   (frontend proxy — not an agent route)
Content-Type: multipart/form-data
Body: file=<image>

Response 200: { "url": "https://..." }
```

Pass the returned `url` as `payment_proof_url` in the `payment-sent` request. Max 5 MB, images only.

---

## MCP server (`p2pai-mcp`)

```json
{
  "mcpServers": {
    "p2pai": {
      "command": "npx",
      "args": ["-y", "p2pai-mcp"],
      "env": {
        "P2PAI_API_URL":       "https://p2pai.xyz",
        "P2PAI_BUYER_ADDRESS":  "0x<your-wallet>",
        "P2PAI_SELLER_ADDRESS": "0x<your-wallet>"
      }
    }
  }
}
```

| Tool | Endpoint |
|---|---|
| `list_orders` | `GET /api/orders` |
| `get_trade` | `GET /api/trades/:id` |
| `get_my_trades` | `GET /api/trades/by-user` |
| `create_order` | `POST /api/orders` |
| `match_order` | `POST /api/trades` |
| `mark_payment_sent` | `POST /api/trades/:id/payment-sent` |
| `confirm_payment` | `POST /api/trades/:id/confirm-payment` |
| `get_trade_status_description` | Synthesized from `GET /api/trades/:id` |
