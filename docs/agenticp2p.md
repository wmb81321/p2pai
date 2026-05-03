# p2pai — Architecture

> **Status: superseded as of v2.0.0.**
>
> This document describes the v1.x Stripe-based architecture. It is kept for historical reference only.
> For the current v2.3.0 architecture, see:
> - **[docs/agent-api.md](./agent-api.md)** — authoritative v2.3 API reference
> - **[CLAUDE.md](../CLAUDE.md)** — full stack, trade state machine, and hard rules
> - **[ROADMAP.md](../ROADMAP.md)** — phase plan and what was cut

---

## 1. What it is

A P2P crypto-fiat settlement app where an AI Agent acts as a neutral coordinator
between a seller (has USDC, wants USD) and a buyer (has USD, wants USDC). Neither
party needs to trust the other — they trust the Agent's settlement logic and
Stripe's cryptographic webhooks.

---

## 2. Settlement flows

### Flow A — Sell order (crypto → fiat)

```
Seller posts SELL order
    ↓
Buyer matches → Agent creates trade, derives virtual deposit address
    ↓
Seller deposits USDC to virtual address
    → auto-forwards to Agent master wallet (TIP-20 Virtual Address)
    ↓
Buyer pays USD via Stripe Link spend request
    → Agent creates spend request against buyer's own Stripe Link PM
    → Buyer (or buyer agent) approves
    → payment_intent.succeeded webhook fires
    ↓
Agent sends USD to Seller via Stripe Connect transfer
    ↓
transfer.paid webhook fires
    → Agent releases USDC on-chain to Buyer
    ↓
Both parties rate → complete
```

### BUY order (roles swapped)

Identical flow. When a BUY order is matched:
- Order poster = buyer (pays USD, receives USDC)
- Matcher = seller (deposits USDC, receives USD)

`matchOrder()` derives roles from `order.type` automatically.

### Agentic flow

Both sides can be run by autonomous agents:

**Seller agent** (`scripts/seller-agent.ts` — Phase 9):
1. Polls Supabase for `created` trades where `seller_address = SELLER_ADDRESS`
2. Calls `tempo wallet transfer` to deposit USDC to `virtual_deposit_address`
3. Polls until `deposited`

**Buyer agent** (`scripts/buyer-agent.ts`):
1. Polls Supabase for `deposited` trades where `buyer_address = BUYER_ADDRESS`
2. Calls `POST /api/trades/:id/link-pay` → gets `{ spendRequestId, approvalUrl }`
3. Approves via `approvalUrl` (or `AUTO_APPROVE=1` opens it automatically)
4. Platform agent handles everything after approval

---

## 3. State machine

```
created
  ↓  (seller deposits USDC, TIP-20 Transfer event detected)
deposited
  ↓  (buyer's payment_intent.succeeded webhook received and verified)
fee_paid
  ↓  (Stripe Connect transfer created for seller)
fiat_sent
  ↓  (transfer.paid webhook received and verified)
released
  ↓  (both parties submit ratings)
complete

Failure states (terminal):
  deposit_timeout   — 30 min without deposit → seller notified, USDC refundable
  stripe_failed     — payment or transfer failed
  refunded          — agent returned USDC to seller
```

All state writes happen in Supabase **before** the side-effect (on-chain or fiat) executes.
This makes every step crash-recoverable — restarting the agent replays from last persisted state.

---

## 4. Stack

| Layer | Technology | Notes |
|---|---|---|
| Blockchain | Tempo (Moderato testnet, chain ID 42431) | Sub-second finality, TIP-20 stablecoins |
| Crypto escrow | TIP-20 Virtual Addresses | Per-trade address, auto-forwards to agent master wallet. No custom Solidity. |
| Deposit detection | `viem watchContractEvent` | Watches `Transfer` events on PathUSD contract with `to === virtualAddress` |
| Agent wallet | Tempo EOA + access keys | `AGENT_MASTER_ID` + `AGENT_ACCESS_KEY`; access keys have `maxSpend` + `expiry` |
| Service fee | `mppx` HTTP 402 session | `POST /trades/:id/settle` — trustless, public endpoint; fee = authorization |
| Buyer fiat (primary) | Stripe Link spend request | Per-buyer PM (`csmrpd_...`) stored in `users.link_payment_method_id`; spend request created by platform, approved by buyer |
| Buyer fiat (fallback) | Stripe PaymentElement + SetupIntent | Off-session charge via saved card; `stripe_customer_id` + `stripe_buyer_pm_id` in `users` |
| Seller fiat | Stripe Connect Express + Global Payouts | `transfer_data.destination` = seller's `stripe_account`; Stripe API `2026-04-22.preview` |
| Fiat verification | Stripe signed webhook | `constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)` — no bypass, no mock in prod |
| Database | Supabase Postgres + Realtime + RLS | Order book via Realtime; RLS on all tables; service-role key server-only |
| Frontend | Next.js 15 App Router on Vercel | Server-only proxy routes to agent; anon Supabase key in browser only |
| Agent runtime | TypeScript / Node.js on Railway | Persistent server (required for deposit monitor + webhook listener) |
| User wallet | Tempo Wallet (`tempoWallet()` wagmi connector) | Passkey-based; `tempoModerato` from `viem/chains` |

---

## 5. Components

### Agent (`agent/`)

```
src/
  index.ts               HTTP server boot, route registration, initLinkCli()
  flows/
    flowA.ts             continueAfterFeePaid(), releaseUsdcToBuyer()
  routes/
    trades.ts            POST /trades, POST /trades/:id/link-pay, POST /trades/:id/settle
    webhooks.ts          POST /webhooks/stripe — constructEvent → route to handler
  stripe/
    client.ts            Stripe SDK instance (API 2026-04-22.preview)
    payouts.ts           Stripe Connect transfer to seller
    webhook.ts           registerFlowAHandlers()
  tempo/
    wallet.ts            viem WalletClient for on-chain USDC transfer
    monitor.ts           watchDeposit() — Transfer event watcher per virtual address
    virtualAddresses.ts  deriveDepositAddress() — VirtualAddress.from({ masterId, userTag })
    chain.ts             Tempo chain config (Moderato)
  lib/
    env.ts               Zod-validated environment variables
    schemas.ts           TradeRowSchema, OrderRowSchema
    router.ts            createRouter() — Bearer auth middleware, route matching
    supabase.ts          db client, updateTradeStatus()
    mppx.ts              chargeServiceFee() — mppx session wrapper
    link.ts              initLinkCli(), createSpendRequest(), pollForApproval(), getCard()
```

### Frontend (`frontend/`)

```
app/
  orderbook/             Order book with Supabase Realtime, filter tabs
  trades/[id]/           Trade tracker, LinkPayButton, BuyerPaymentForm, rating widget
  account/               Wallet, balance, Stripe Connect, Link PM setup, saved card, history
  api/                   All server-side proxy routes (see API surface in CLAUDE.md)
  stripe/                Return page (Stripe redirect after PaymentElement confirm)
components/
  connect-button.tsx     Tempo Wallet connect/disconnect + user upsert
  place-order-modal.tsx  New order form
  link-pay-button.tsx    Stripe Link payment button (primary) — polls trade status
  buyer-payment-form.tsx Stripe Elements PaymentElement (fallback)
  save-card-form.tsx     SetupIntent card registration form
  link-pm-setup.tsx      Stripe Link PM ID registration (csmrpd_...)
  stripe-connect-button.tsx Seller onboarding
  balance-display.tsx    PathUSD balance via Hooks.token.useGetBalance
```

### Buyer agent (`scripts/buyer-agent.ts`)

Standalone Node script. Polls Supabase for `deposited` trades for a wallet address,
calls `link-pay`, logs the approval URL. `AUTO_APPROVE=1` opens it in a browser.

---

## 6. Security properties

| Property | How it's enforced |
|---|---|
| Fiat payment verified before USDC release | `payment_intent.succeeded` webhook with `constructEvent()` signature check |
| No double-release | Supabase state check before every transition — idempotent |
| No double-charge | `stripe_payment_intent_id` idempotency check in auto-pay; SetupIntent tracks PM per customer |
| Crypto escrow non-custodial | Virtual Addresses auto-forward to agent wallet; agent only releases on verified payment |
| Service fee trustless | `POST /trades/:id/settle` is public — mppx 0.1 USDC payment IS the auth |
| Buyer payment P2P | Buyer's PM stays in their own Stripe Link account; platform creates spend request, buyer approves |
| Agent API auth | All routes except `/health`, `/webhooks/stripe`, `/trades/:id/settle` require `Authorization: Bearer <AGENT_API_KEY>` |
| Race condition safe | `POST /trades` atomically updates order `status = 'open' → matched` with `WHERE status = 'open'` |
| RLS | All Supabase tables have RLS; browser uses anon key; server routes use service-role key |

---

## 7. What was deliberately cut from the MVP

These items are in the Phase 13 backlog (ROADMAP.md):

| Cut component | Reason | Future path |
|---|---|---|
| TEE (Trusted Execution Environment) | Stripe webhook verification doesn't need a TEE — HMAC-SHA256 is fast and deterministic | Re-evaluate when on-chain attestation is required |
| ERC-8004 identity + reputation | On-chain registry not required for Moderato testnet P2P | Phase 13 — add after mainnet |
| Solidity escrow contract | Virtual Addresses provide equivalent escrow without custom Solidity | Phase 13 — if auditable on-chain escrow is required |
| Privy embedded wallets | Tempo Wallet natively handles passkeys + embedded UX | Not needed |
| Flow B (fiat → crypto via SPT pull) | MVP covers both directions via SELL and BUY orders + spend requests | Phase 13 — expand to dedicated SPT pull flow |

---

## 8. Next phases

See `ROADMAP.md` for the full breakdown. In priority order:

1. **Phase 8** — Agent API spec document (`docs/agent-api.md`)
2. **Phase 9** — Seller agent script (`scripts/seller-agent.ts`)
3. **Phase 10** — End-to-end agentic test (`scripts/e2e-agentic.ts`)
4. **Phase 11** — Security hardening pass
5. **Phase 12** — Mainnet deploy
