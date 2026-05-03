# p2pai

Agentic P2P crypto-fiat settlement on Tempo. An AI Agent coordinates trades between unknown counterparties — using Tempo Virtual Addresses for USDC escrow and direct counterparty payments (Zelle, Venmo, bank transfer, etc.) for fiat. No Stripe, no custom Solidity, no centralized custody.

**Agent (Railway):** `https://convexo-p2p-agent-production.up.railway.app`  
**Frontend (Vercel):** `https://p2pai.xyz`

---

## What Works Today (v2.3.0 · Moderato Testnet)

- **Order book** — live BUY/SELL orders with Supabase Realtime; filter by All/Buy/Sell; own orders expandable with cancel button
- **Place orders** — pay 0.1 USDC service fee (mppx push mode) → order created with per-order virtual deposit address; payment methods shown inline for SELL orders
- **Match orders** — pay 0.1 USDC taker fee (mppx push mode) → trade created; match a sell order to buy USDC, or match a buy order to sell USDC
- **In-app USDC deposit** — seller taps "Send X USDC" on the trade page; `Hooks.token.useTransferSync` broadcasts the TIP-20 transfer from their connected wallet to the virtual deposit address (no copy-paste required)
- **Full settlement** — seller deposits USDC → buyer pays fiat directly → USDC released on-chain
- **Payment methods** — sellers register Zelle/Venmo/CashApp/bank/wire on `/account`; snapshotted at order creation and shown on the trade page so buyers know how to pay
- **Payment confirmation** — buyer marks payment sent (method + reference + optional proof image or URL); seller confirms receipt → USDC released on-chain
- **Image proof upload** — buyer can upload a payment screenshot directly in `PaymentSentForm`; stored in Supabase Storage (`payment-proofs` bucket, 5 MB limit)
- **Mutual cancellation** — either party can request cancellation; the other party must confirm or reject; USDC is refunded to seller if already deposited
- **Trade tracker** — real-time status per trade with deposit panel, payment forms, cancel/reject-cancel panel, and progress stepper
- **Ratings** — both parties rate each other (1–5 stars) after settlement; `rating_avg` tracked per user
- **Account page** — pathUSD balance via `Hooks.token.useGetBalance`, in-app testnet faucet, payment methods editor, order/trade history
- **In-app testnet faucet** — one-click test tokens via `Hooks.faucet.useFundSync`
- **Agent-native settle path** — autonomous agents can call `POST /trades/:id/settle` with Bearer auth; seller still confirms receipt manually
- **MCP server** — `p2pai-mcp` npm package with 8 tools; any Claude agent can add it to their `mcp.json` and trade autonomously

---

## Settlement Flow

```
Seller posts SELL order (pays 0.1 USDC maker fee via mppx)
  ↓
Counter-party matches (pays 0.1 USDC taker fee via mppx) → Agent creates trade + virtual deposit address
  ↓
Seller sends USDC to virtual address → auto-forwards to Agent master wallet → status: deposited
  ↓
Buyer sees seller's payment methods on /trades/[id], sends fiat off-platform
  ↓
Buyer fills PaymentSentForm (method + reference + optional proof image/URL) → status: payment_sent
  ↓
Seller sees ConfirmPaymentPanel with buyer's payment details, verifies fiat arrived
  ↓
Seller clicks "I received $X — Release USDC" → status: payment_confirmed
  ↓
Agent transfers USDC on-chain to buyer → status: released → complete
  ↓
Both parties rate the trade (1–5 stars)
```

BUY orders follow the same flow with roles swapped: order poster is buyer, matcher is seller.

### Cancellation

Either party can request cancellation at any point before `payment_confirmed`. The first party to call `POST /trades/:id/cancel` moves the trade to `cancel_requested`. The other party then sees a Confirm / Reject panel:

- **Confirm** → trade moves to `cancelled` (if no USDC was deposited) or `refunding` → `refunded` (USDC returned to seller on-chain); order reopened to `open`.
- **Reject** → trade reverts to the status it had before the cancel was requested; trade continues normally.

Calling cancel again as the same requesting party is an idempotent no-op.

### Agent-native path (no UI, Bearer auth)

```bash
# Autonomous agent places an order (pays 0.1 USDC maker fee via mppx push mode)
POST /orders              # 402 challenge → pay 0.1 USDC via mppx → order created with VA

# Agent matches an order (pays 0.1 USDC taker fee via mppx push mode)
POST /trades              # 402 challenge → pay 0.1 USDC → trade created

# Deprecated settle path (marks payment_sent only; seller still confirms)
POST /trades/:id/settle   # Bearer auth (no fee) → marks payment_sent with method='x402'
POST /trades/:id/confirm-payment  # releases USDC on-chain
```

---

## Stack

| Layer | Tech |
|---|---|
| Blockchain | Tempo (Moderato testnet, chain ID 42431) |
| USDC escrow | TIP-20 Virtual Addresses (per-order, auto-forward to master wallet) |
| Fiat payment | **Direct counterparty** — Zelle, Venmo, CashApp, bank transfer, wire, PayPal |
| Maker fee | MPP x402 via `mppx` (0.1 USDC, charged at `POST /orders`; forfeited on cancel/expiry) |
| Taker fee | MPP x402 via `mppx` (0.1 USDC, charged at `POST /trades`; `externalId = taker_<buyer>_<orderId>`) |
| Database | Supabase Postgres + Realtime + RLS + Storage (payment-proofs bucket) |
| Frontend | Next.js 15 App Router on Vercel |
| Agent | TypeScript / Node.js on Railway (persistent server) |
| Wallet | Tempo Wallet (`tempoWallet()` from `wagmi/connectors`) — passkey-based, push mode for mppx |
| Balance | `Hooks.token.useGetBalance` from `wagmi/tempo` (pathUSD) |
| In-app transfer | `Hooks.token.useTransferSync` from `wagmi/tempo` (USDC deposit to virtual address) |

---

## Local Dev

```bash
git clone <repo-url> p2pai && cd p2pai
cp .env.example .env
# Fill in keys — see .env.example for all required vars

# Agent (port 3001)
pnpm --filter agent dev   # or: cd agent && npx tsx watch src/index.ts

# Frontend (port 3000)
pnpm --filter frontend dev  # or: cd frontend && pnpm dev
```

> HTTPS is required for WebAuthn passkeys. The frontend dev script runs with `next dev --experimental-https`. For a named `.localhost` domain, use `portless run dev`.

---

## Deployment

| Service | Platform | Trigger |
|---|---|---|
| Agent | Railway | `git push origin main` — auto-deploys (root: `/agent`, Dockerfile) |
| Frontend | Vercel | `git push origin main` — auto-deploys (root: `/frontend`, Next.js) |

```bash
railway logs --tail          # stream agent logs
railway variables set KEY=V  # set agent env var
```

---

## Folder Map

```
agent/
  src/flows/flowManual.ts    markPaymentSent() + confirmPayment() — manual settlement
  src/routes/orders.ts       POST /orders (mppx x402 gate) + POST /orders/:id/cancel
  src/routes/trades.ts       POST /trades (mppx taker fee), /payment-sent, /confirm-payment,
                             /cancel (mutual), /reject-cancel, /settle (deprecated)
  src/tempo/                 Virtual addresses, deposit monitor, on-chain transfers
  src/lib/                   env.ts, supabase.ts, mppx.ts, router.ts, schemas.ts

frontend/
  app/orderbook/             Live order book — own orders expandable/cancellable, Realtime
  app/trades/[id]/           Trade tracker — deposit button, payment forms, cancel/reject panel, rating
  app/account/               pathUSD balance, faucet, payment methods, order/trade history
  app/api/                   Server-side proxy routes → Railway agent + Supabase reads
  app/api/upload-proof/      POST — uploads payment proof image to Supabase Storage
  components/
    place-order-modal.tsx    mppx/client push mode 402 payment; payment methods for SELL orders
    payment-sent-form.tsx    Buyer marks fiat sent (method + reference + proof image/URL)
    confirm-payment-panel.tsx Seller confirms receipt → USDC released on-chain
    payment-methods-editor.tsx Seller registers Zelle/Venmo/CashApp/Wire/Bank/PayPal/Other
    balance-display.tsx      pathUSD balance via Hooks.token.useGetBalance

scripts/
  buyer-agent.ts             Polls for deposited trades → calls POST /payment-sent autonomously
  seller-agent.ts            Polls for created trades → deposits USDC to virtual address autonomously
  e2e-agentic.ts             Full headless trade test — seller + buyer agents, Moderato testnet

mcp-server/
  src/index.ts               p2pai-mcp npm package — 8 MCP tools for agents

supabase/
  migrations/                011 migrations applied (Stripe columns dropped)

docs/
  agent-api.md               Full v2.2 API reference — all endpoints, auth, state machine
  tempo/tempoSDK.md          Full Tempo Accounts SDK reference
```

---

## Testnet

```bash
# Fund wallet with test tokens (or use "+ testnet" on Account page)
tempo wallet fund

# Check agent wallet balance
cast balance 0x6772787e16a7ea4c5307cc739cc5116b4b26ffc0 \
  --rpc-url https://rpc.moderato.tempo.xyz

# Testnet tokens (all 6 decimals)
# pathUSD:  0x20c0000000000000000000000000000000000000
# AlphaUSD: 0x20c0000000000000000000000000000000000001
# BetaUSD:  0x20c0000000000000000000000000000000000002
# ThetaUSD: 0x20c0000000000000000000000000000000000003
```

---

## MCP Tools (for autonomous agents)

```bash
npx p2pai-mcp   # or add to mcp.json
```

| Tool | Description |
|---|---|
| `list_orders` | Browse open orders on the book |
| `get_trade` | Fetch trade details and current status |
| `get_my_trades` | Your full trade history for a wallet |
| `create_order` | Post a new SELL or BUY order (pays maker fee) |
| `match_order` | Match an existing order to create a trade (pays taker fee) |
| `mark_payment_sent` | Buyer marks fiat as sent (method + reference) |
| `confirm_payment` | Seller confirms receipt → USDC released on-chain |
| `get_trade_status_description` | Human-readable next step for a trade |

---

## What's Next

See [ROADMAP.md](./ROADMAP.md) for the full phase plan. See [docs/agent-api.md](./docs/agent-api.md) for the full API reference.

- **Phase 13** — Mainnet deploy (switch chain, real USDC)
- **Phase 14** — Plaid bank integration: read-only balance signal at trade time
