# p2pai — Project Memory

p2pai is an agentic P2P crypto-fiat settlement app. An AI Agent coordinates trades between unknown counterparties using Tempo's native primitives. Crypto escrow is handled via Tempo Virtual Addresses (TIP-20 native deposit attribution that auto-forwards to a master wallet); fiat moves **directly between counterparties** (Zelle, Venmo, bank transfer, wire, etc.); the seller confirms receipt in the app and the agent then releases USDC on-chain. A 0.1 USDC service fee is charged via MPP (`mppx`) at **order creation** (maker fee) and again at **trade creation** (taker fee) — fees are forfeited on cancel or expiry. No Stripe, no custom Solidity, no TEE, no ERC-8004, no Privy in the MVP — Tempo Wallet, Virtual Addresses, MPP, and Supabase carry the full stack.

---

## Current Build Status (2026-05-03) — v2.4.0

**Domain → p2pai.xyz. SKILL.md agent onboarding. Taker fee. Mutual cancellation with USDC refund. Image proof upload. Agent API spec. Stripe columns dropped. 11 migrations applied.**

| Layer | Status | Notes |
|---|---|---|
| Supabase schema + RLS | ✓ Live | `users`, `orders`, `trades`, `ratings` — 11 migrations applied |
| Migration 007 | ✓ Applied | `orders.virtual_deposit_address` (unique), `service_fee_paid_at`, `service_fee_tx_hash`; legacy open orders expired |
| Migration 008 | ✓ Applied | `orders.seller_payment_methods` jsonb — payment method snapshot at order creation |
| Migration 009 | ✓ Applied | `cancelled` and `refunding` added to trade status enum |
| Migration 010 | ✓ Applied | `cancel_requested` status; `trades.cancel_requested_by`; `trades.cancel_requested_from_status` |
| Migration 011 | ✓ Applied | Drop legacy Stripe columns from `users` and `trades` (10 columns removed) |
| Tempo Virtual Address | ✓ Registered | `AGENT_MASTER_ID=0x3ead6d3d`, on-chain Moderato testnet |
| Agent wallet (EOA) | ✓ Funded | `0x6772787e16a7ea4c5307cc739cc5116b4b26ffc0` |
| Railway agent | ✓ Live | v2.3.0 — no global Bearer gate; address-in-body auth |
| Railway deploy method | ✓ Git-push | Repo: `wmb81321/p2pai`, root dir: `/agent`, builder: Dockerfile |
| Vercel frontend | ✓ Live | v2.4.0 at p2pai.xyz — taker fee, mutual cancel UI, image proof upload, SKILL.md |
| `POST /orders` (agent) | ✓ Live | Public — mppx x402 gate (maker fee 0.1 USDC); creates order + VA; fee forfeited on cancel |
| `POST /orders/:id/cancel` (agent) | ✓ Live | Address-verified (requester must be order creator), DB-only cancel |
| `POST /trades` (agent) | ✓ Live | mppx x402 gate (taker fee 0.1 USDC); `externalId = taker_<buyer>_<orderId>`; creates trade |
| `POST /trades/:id/payment-sent` | ✓ Live | Buyer marks fiat sent; `buyer_address` in body verified against trade |
| `POST /trades/:id/confirm-payment` | ✓ Live | Seller confirms receipt; `seller_address` verified → USDC release |
| `POST /trades/:id/cancel` | ✓ Live | Mutual — first call = `cancel_requested`; second call from other party = execute + refund if deposited |
| `POST /trades/:id/reject-cancel` | ✓ Live | Non-requester rejects cancel; reverts to `cancel_requested_from_status` |
| `POST /trades/:id/settle` | ✓ Code ready | Deprecated — now Bearer-auth only, no fee charged |
| `PaymentSentForm` component | ✓ Live | Buyer UI: method selector + reference + image upload + optional proof URL |
| `ConfirmPaymentPanel` component | ✓ Live | Seller UI: shows buyer's payment details + confirm button |
| `PaymentMethodsEditor` component | ✓ Live | Seller adds Zelle/Venmo/Wire/etc. on `/account` |
| Image proof upload | ✓ Live | `/api/upload-proof` → Supabase Storage `payment-proofs` bucket; 5 MB limit; images only |
| Order book | ✓ Live | BUY + SELL orders, filter tabs, Realtime, own orders expand/cancel |
| Place order modal | ✓ Live | mppx/client push mode (maker fee); payment methods for SELL orders; balance check + fee warning |
| Match order (taker fee) | ✓ Live | mppx/client push mode wraps `POST /api/trades`; `externalId = taker_<buyer>_<orderId>` |
| Trade tracker | ✓ Live | Deposit button, PaymentSentForm, ConfirmPaymentPanel, cancel/reject-cancel panel, rating widget |
| Account page | ✓ Live | Balance (native hook), faucet, payment methods editor, order/trade history |
| Ratings | ✓ Live | 1-5 stars after released/complete, updates rating_avg |
| BUY order matching | ✓ Live | Buyer/seller roles swapped correctly for BUY orders |
| MCP server (`p2pai-mcp`) | ✓ v2.0.0 | 8 tools — `mark_payment_sent`, `confirm_payment`, `settle_trade` etc. |
| `/agents` page | ✓ Live | User onboarding — Tempo-style `claude -p "Read https://p2pai.xyz/SKILL.md..."` flow; wallet-aware |
| `SKILL.md` route | ✓ Live | `p2pai.xyz/SKILL.md` — machine-readable setup file; Claude reads + runs `claude mcp add` automatically |
| Public `GET /api/orders` | ✓ Live | No-auth order listing; `?type=`, `?status=`, `?id=` query params |
| mppx push mode | ✓ Live | `mode: 'push'` for both maker fee (place order) and taker fee (match order); no `feePayer: true` in agent config |
| Stripe agent code | ✗ Removed | `agent/src/stripe/`, `agent/src/lib/link.ts`, `agent/src/routes/webhooks.ts`, `flowA.ts` deleted |
| Stripe frontend routes | ✗ Stubbed (410) | `/api/stripe/*`, `/api/users/link-pm`, `/api/trades/[id]/{link-pay,auto-pay,payment-intent}` |
| Stripe components | ✗ Stubbed | `BuyerPaymentForm`, `LinkPayButton`, `LinkPmSetup`, `SaveCardForm`, `StripeConnectButton` are now `export {}` |
| Stripe webhook | ✗ Removed | `we_1TSOSkIeMhBdGlf7tM8ekyQI` no longer routes to anything |
| Agent API spec doc | ✓ Done | `docs/agent-api.md` — full v2.2 reference, all endpoints, state machine, mppx setup |
| Cleanup pass (Phase 10) | ✓ Done | Migration 011; `frontend/app/stripe/` removed; buyer-agent.ts fixed; stale commands removed |
| Seller agent script | ✗ Phase 11 | `scripts/seller-agent.ts` — auto-deposit on matched orders |
| End-to-end agentic test | ✗ Phase 12 | `scripts/e2e-agentic.ts` — full headless trade on testnet |
| Mainnet deploy | ✗ Phase 13 | Switch chain, real USDC |
| Plaid integration | ✗ Phase 14 | Bank account connect + balance signal at trade time (planned) |

---

## Folder Structure

| Folder | Purpose | Deployed to |
|---|---|---|
| `frontend/` | Next.js App Router — order book, trade tracker, account, payment forms | Vercel |
| `frontend/app/api/` | Server-side proxy routes forwarding to Railway agent (`FACILITATOR_URL`) | Vercel (server) |
| `frontend/components/` | `PaymentSentForm`, `ConfirmPaymentPanel`, `PaymentMethodsEditor`, `PlaceOrderModal`, `BalanceDisplay`, `ConnectButton`, `AgentsContent` | Vercel |
| `agent/` | TypeScript settlement runtime — HTTP server, state machine, deposit monitor | Railway (persistent) |
| `agent/src/flows/` | `flowManual.ts` — `markPaymentSent` and `confirmPayment` | Railway |
| `agent/src/routes/` | `orders.ts` — POST /orders + cancel; `trades.ts` — payment-sent, confirm-payment, cancel, reject-cancel, settle | Railway |
| `agent/src/tempo/` | `wallet.ts`, `monitor.ts`, `chain.ts`, `virtualAddresses.ts` | Railway |
| `agent/src/lib/` | `env.ts`, `mppx.ts`, `router.ts`, `schemas.ts`, `supabase.ts` (no `link.ts`) | Railway |
| `supabase/` | SQL migrations (010 applied) + RLS policies | Supabase (production) |
| `scripts/` | `buyer-agent.ts` — currently stale; rewrite pending for v2.0 | Local / any Node host |
| `mcp-server/` | `p2pai-mcp` npm package — stdio MCP, 8 v2.0 tools | npm / `npx` |
| `docs/` | Architecture references | — |
| `.claude/` | Workspace rules, slash commands, hooks | — |
| `.agents/skills/` | tempo-docs, x402, plus legacy stripe-best-practices / create-payment-credential / privy (kept as reference) | — |

### Why two deployments?

The **agent** needs a persistent long-running process (deposit monitor, on-chain signing). Vercel serverless functions time out and can't maintain state. The **frontend** calls the agent via `FACILITATOR_URL` (server-only env var, never `NEXT_PUBLIC_`).

---

## Stack

| Layer | Tech | Key Constraint |
|---|---|---|
| User wallet | Tempo Wallet (`tempoWallet()` wagmi connector) | Import `tempoModerato` from `viem/chains`, `tempoWallet` from `wagmi/connectors` |
| Deposits | TIP-20 Virtual Addresses | `VirtualAddress.from({ masterId, userTag: tradeId })` — userTag never reused |
| Agent wallet | Tempo master wallet + access keys | `AGENT_MASTER_ID` immutable; access keys carry `maxSpend` + `expiry` |
| Service fee | MPP via `mppx` (maker + taker) | Maker: `externalId = orderId` at `POST /orders`; Taker: `externalId = taker_<buyer>_<orderId>` at `POST /trades` |
| Buyer fiat | **Direct counterparty payment** (Zelle/Venmo/Wire/Bank/CashApp/PayPal/Other) | Buyer marks sent with method + reference + optional proof URL |
| Seller payout | **Direct counterparty payment** | Seller confirms receipt manually; trust + ratings replace escrow |
| Release trigger | Seller-confirmed receipt | `confirmPayment()` checks `seller_address`, then transfers USDC on-chain |
| On-chain transfer | viem `transferUsdc` from agent EOA | Single-tx, sub-second finality on Tempo |
| Balance reading | `Hooks.token.useGetBalance` from `wagmi/tempo` | Not `useReadContract` — native TIP-20 hook |
| Testnet faucet | `Hooks.faucet.useFundSync` from `wagmi/tempo` | In-app, no redirect, testnet only |
| Order book | Supabase Realtime + Postgres | RLS on every table; anon key in browser only |
| Frontend | Next.js 15 App Router | Service-role key never in browser bundles |
| Agent | TypeScript / Node.js | Idempotent; Supabase write before every side-effect |

---

## Database Schema (10 migrations)

| Migration | What it adds |
|---|---|
| `001_schema.sql` | `users`, `orders`, `trades`, `ratings` tables + enums |
| `002_rls.sql` | Row-level security policies |
| `003_stripe_payment_intent.sql` | `trades.stripe_payment_intent_id` (legacy, unused in v2.0) |
| `004_link_fields.sql` | `trades.link_spend_request_id`, `users.link_payment_method_id` (legacy) |
| `005_buyer_payment_method.sql` | `users.stripe_customer_id` etc. (legacy) |
| `006_manual_payment.sql` | New trade statuses (`payment_sent`, `payment_confirmed`, `disputed`); `trades.payment_method`, `payment_reference`, `payment_proof_url`, `payment_sent_at`, `payment_confirmed_at`; `users.payment_methods` jsonb |
| `007_order_deposit_address.sql` | `orders.virtual_deposit_address` (unique), `orders.service_fee_paid_at`, `orders.service_fee_tx_hash`; expires legacy open orders |
| `008_order_payment_methods.sql` | `orders.seller_payment_methods` jsonb — payment method snapshot at order creation |
| `009_cancel_statuses.sql` | `cancelled` and `refunding` added to trade status enum |
| `010_cancel_columns.sql` | `cancel_requested` status; `trades.cancel_requested_by` (text); `trades.cancel_requested_from_status` (trade_status) |

Legacy Stripe columns (`stripe_account`, `link_payment_method_id`, `stripe_customer_id`, `stripe_buyer_pm_id`, `stripe_buyer_card_brand`, `stripe_buyer_card_last4`, `stripe_payment_intent_id`, `link_spend_request_id`, `stripe_payout_id`, `stripe_account_id`) remain in the schema for backward compatibility but are NOT written by any v2.0+ code path. They will be dropped in a future migration.

---

## Trade State Machine

```
created → deposited → payment_sent → payment_confirmed → released → complete
```

Any of `created`, `deposited`, or `payment_sent` can transition to `cancel_requested` (first party calls `POST /trades/:id/cancel`). From `cancel_requested`:
- Other party **confirms** (`POST /trades/:id/cancel`) → `cancelled` if no USDC deposited; or `refunding` → `refunded` (USDC returned to seller on-chain) if deposited. Order is reopened to `open` in both cases.
- Other party **rejects** (`POST /trades/:id/reject-cancel`) → reverts to the status stored in `cancel_requested_from_status`.
- Same party calls cancel again → idempotent no-op.

**Agent entry points (no global Bearer gate — address in body IS identity):**
- `POST /trades/:id/payment-sent` (`buyer_address` in body verified against trade row) → `markPaymentSent()` → `payment_sent`
- `POST /trades/:id/confirm-payment` (`seller_address` in body verified against trade row) → `confirmPayment()` → `payment_confirmed` → on-chain `transferUsdc` → `released` → `complete`
- `POST /trades/:id/cancel` (address-verified, either party) → first call = `cancel_requested`; second call from other party = execute cancel + optional refund
- `POST /trades/:id/reject-cancel` (address-verified, non-requester) → reverts to `cancel_requested_from_status`
- `POST /trades/:id/settle` (Bearer auth, deprecated) → `markPaymentSent()` with `method='x402'`, then still requires `confirm-payment` to release USDC

**Failure states:** `deposit_timeout` (30 min), `disputed`, `refunded`, `cancelled`, `refunding`

**Legacy statuses kept on the enum for backward compat with old rows:** `fee_paid`, `fiat_sent`, `stripe_failed` — never written by v2.0+ code.

All transitions write Supabase BEFORE the side-effect runs.

---

## The Flow

### SELL order match (seller posts, buyer matches)
1. Seller posts SELL order on `/orderbook` (and ideally has at least one entry in `/account` → Payment Methods so the buyer sees it).
2. Buyer matches → agent creates trade, derives virtual deposit address, locks the order.
3. Seller deposits USDC to the virtual address → auto-forwards to master wallet → trade transitions to `deposited`.
4. Buyer opens `/trades/[id]`, sees the seller's payment methods (Zelle/Venmo/Wire/etc.), pays the seller off-platform with the agreed USD amount.
5. Buyer fills `PaymentSentForm` (method + reference number + optional proof URL) → `POST /api/trades/[id]/payment-sent` → trade transitions to `payment_sent`.
6. Seller opens `/trades/[id]`, sees `ConfirmPaymentPanel` with the buyer's payment details, verifies the funds arrived in their account.
7. Seller clicks "I received $X — Release USDC" → `POST /api/trades/[id]/confirm-payment` → trade transitions to `payment_confirmed` → agent transfers USDC on-chain to buyer → `released` → `complete`.
8. Both parties rate each other (1-5 stars).

### BUY order match (roles swapped)
- Order poster = buyer (wants USDC, will pay USD).
- Matcher = seller (deposits USDC, receives USD).
- Same agent flow from step 3 onward.

### Agent-native crypto path (no UI, x402)
1. Agent observes `deposited` trade via the public order/trade APIs.
2. Agent calls `POST /api/trades/:id/settle` — receives 402 with mppx challenge.
3. Agent pays 0.1 USDC via mppx, retries — agent marks `payment_sent` with `method='x402'`, `reference=tradeId`.
4. Seller (human or another agent) still needs to call `POST /trades/:id/confirm-payment` to actually release USDC. The x402 payment IS proof-of-fee but NOT proof-of-fiat-receipt.

---

## API Surface (all endpoints)

### Agent (Railway)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | public | Health check, returns `{ status: 'ok', version: '2.2.0' }` |
| POST | `/orders` | **public** (mppx 402) | Pay 0.1 USDC maker fee → creates order + derives per-order virtual deposit address |
| POST | `/orders/:id/cancel` | address-verified | Requester address must match order creator; DB-only cancel; VA persists; fee forfeited |
| POST | `/trades` | **public** (mppx 402) | Pay 0.1 USDC taker fee (`externalId = taker_<buyer>_<orderId>`) → creates trade |
| POST | `/trades/:id/payment-sent` | address-verified | `buyer_address` in body verified against trade; marks fiat sent → `payment_sent` |
| POST | `/trades/:id/confirm-payment` | address-verified | `seller_address` in body verified against trade; releases USDC → `complete` |
| POST | `/trades/:id/cancel` | address-verified (either) | First call = `cancel_requested`; second call from other party = execute + refund if deposited |
| POST | `/trades/:id/reject-cancel` | address-verified (non-requester) | Rejects cancel request; reverts trade to `cancel_requested_from_status` |
| POST | `/trades/:id/settle` | Bearer | **Deprecated** — marks `payment_sent` with `method='x402'`, no fee charged. Use `payment-sent` for new integrations. |

### Frontend proxy (Next.js — server-side, no browser auth needed)

| Method | Path | Description |
|---|---|---|
| POST | `/api/orders` | Proxy to agent with transparent 402 passthrough (browser pays maker fee via mppx/client) |
| POST | `/api/orders/[id]/cancel` | Cancel order (forwards to agent with Bearer auth) |
| GET | `/api/orders` | Public read — `?type=`, `?status=`, `?id=` |
| GET | `/api/orders/by-user` | Orders for a wallet (service-role read) |
| POST | `/api/trades` | Create trade with transparent 402 passthrough (browser pays taker fee via mppx/client) |
| GET | `/api/trades/[id]` | Fetch trade from Supabase |
| POST | `/api/trades/[id]/settle` | Forward to agent settle (deprecated) |
| POST | `/api/trades/[id]/payment-sent` | Forward to agent payment-sent |
| POST | `/api/trades/[id]/confirm-payment` | Forward to agent confirm-payment |
| POST | `/api/trades/[id]/cancel` | Forward to agent mutual cancel |
| POST | `/api/trades/[id]/reject-cancel` | Forward to agent reject-cancel |
| POST | `/api/trades/[id]/rate` | Submit rating (1-5 stars + optional comment) |
| GET | `/api/trades/by-user` | Trades for a wallet (service-role read) |
| GET | `/api/users/me` | Fetch user payment methods + rating + trade count |
| POST | `/api/users/upsert` | Upsert user row on first wallet connect |
| POST | `/api/users/payment-methods` | Save/replace seller's payment methods array |
| POST | `/api/upload-proof` | Upload payment proof image → Supabase Storage `payment-proofs` bucket (5 MB limit, images only) |

### Removed in v2.0 (now return 410 Gone)

`POST /api/stripe/account`, `GET /api/stripe/account-status`, `GET /api/stripe/account/refresh`, `POST /api/stripe/setup-intent`, `POST /api/stripe/payment-method/save`, `POST /api/users/link-pm`, `DELETE /api/users/link-pm`, `POST /api/trades/[id]/link-pay`, `POST /api/trades/[id]/auto-pay`, `POST /api/trades/[id]/payment-intent`. Agent route `POST /webhooks/stripe` is gone entirely (the Stripe webhook in their dashboard is dead).

---

## Skill Trigger Table

| Skill | Install | Activate when... |
|---|---|---|
| `tempo-docs` | `npx skills add tempoxyz/docs` | Tempo protocol, TIP-20, Virtual Addresses, Tempo Wallet, wagmi hooks, `wallet_getBalances` |
| `mppx` | `npx skills add tempoxyz/mpp` | `mppx` library, MPP 402 flows, session vs oneTime, settle endpoint, charge middleware |
| `x402` | installed | HTTP 402 spec reference — use `mppx` skill for implementation |
| `supabase` | plugin | Supabase RLS, migrations, types regeneration |
| `viem-integration` / `wagmi` | plugin | Frontend chain config, on-chain reads, transfers |
| `stripe-best-practices` | installed | NOT used in v2.0 (kept as reference only) |
| `create-payment-credential` | installed | NOT used in v2.0 (kept as reference only) |
| `privy` | installed | Reference only — not used in MVP |

---

## MCP + CLI Tooling

### MCP Servers (configured in `mcp.json`)

| Task | Server name | Prefix | Source |
|---|---|---|---|
| Tempo protocol docs, SDK, source | `tempo` | `mcp__tempo__*` | `https://docs.tempo.xyz/api/mcp` |
| MPP / mppx spec and docs | `mpp` | `mcp__mpp__*` | `https://mpp.dev/api/mcp` |
| Third-party lib docs | `context7` | `mcp__plugin_context7_context7__*` | npx `@upstash/context7-mcp` |
| Supabase | `plugin:supabase` | `mcp__plugin_supabase_supabase__*` | claude.ai plugin |
| Browser automation | `plugin:playwright` | `mcp__plugin_playwright_playwright__*` | claude.ai plugin |
| GitHub | `plugin:github` / `github` | `mcp__github__*` | claude.ai plugin / global |
| Vercel | `plugin:vercel` | `mcp__plugin_vercel_vercel__*` | claude.ai plugin |

### LLM-optimised doc endpoints (no MCP needed)

| Resource | URL |
|---|---|
| Tempo docs index | `https://docs.tempo.xyz/llms.txt` |
| Tempo full docs | `https://docs.tempo.xyz/llms-full.txt` |
| Any Tempo page as Markdown | append `.md` to page URL |
| MPP docs index | `https://mpp.dev/llms.txt` |
| MPP full docs | `https://mpp.dev/llms-full.txt` |

### CLI

| CLI | Auth | Key commands |
|---|---|---|
| `tempo` | Logged in — Moderato key expires 2026-05-31 | `tempo wallet fund`, `tempo wallet transfer` |
| `railway` | Logged in | `git push origin main` deploys; `railway logs` |
| `cast` | Ready | `cast send`, `cast balance` |

---

## Hard Rules for Claude Code

1. **`AGENT_MASTER_ID` is sacred.** Never recompute, never lose.
2. **USDC release ONLY after the seller calls `confirmPayment()` (or the trade reaches `payment_confirmed` by another verified path).** No bypass — the seller signature is the trust anchor in v2.0.
3. **Supabase state written BEFORE every on-chain side-effect.** Crash-recoverable.
4. **MPP amounts in TIP-20 stablecoins.** Never hardcode; read from `CHARGE_AMOUNT_USDC` env.
5. **The seller's address (from the trade row) is the only address allowed to call `/confirm-payment`.** `flowManual.confirmPayment` enforces this; never weaken it.
6. **Access keys carry `maxSpend` and `expiry`.** Never use master passkey programmatically.
7. **No service-role Supabase key in browser-shipped code.**
8. **Never `balanceOf(virtualAddress)`.** Watch `Transfer` events with `to === virtualAddress`.
9. **All HTTP 402 via `mppx`.** Never implement the challenge/response manually.
10. **Deposit timeout: 30 minutes.**
11. **`CHANGELOG.md` updated after every meaningful change.**
12. **`Hooks.token.useGetBalance` from `wagmi/tempo`** for TIP-20 balance reads.
13. **`Hooks.faucet.useFundSync` from `wagmi/tempo`** for testnet faucet.
13a. **`Hooks.token.useTransferSync` from `wagmi/tempo`** for in-app TIP-20 transfers (e.g. seller deposit to virtual address). Never use raw `viem` `writeContract` for user-facing transfers — the hook handles passkey signing and gas sponsorship correctly.
13b. **mppx client must use `mode: 'push'`** when the user wallet is a Tempo passkey wallet. Pull mode (`signTransaction` path) is incompatible — Tempo passkey wallets always attach a `feePayerSignature` using passkey crypto that Revm's ECDSA recovery cannot verify. Never set `mode: 'pull'` or remove `mode: 'push'` from `place-order-modal.tsx`. On the agent side, never set `feePayer: true` in `tempo.charge` — it causes `FeePayerValidationError: rejected fields: feePayerSignature`.
14. **`POST /orders` and `POST /trades` are public mppx-gated endpoints.** `POST /orders` charges the maker fee (0.1 USDC, `externalId = orderId`); `POST /trades` charges the taker fee (0.1 USDC, `externalId = taker_<buyer>_<orderId>`). Both fees are forfeited on cancel or expiry. `POST /trades/:id/settle` is **Bearer-auth only** (deprecated; no fee charged there anymore).
15. **No global Bearer gate on payment endpoints.** `POST /orders/:id/cancel` verifies `requester_address` against `order.creator_address`; `POST /trades/:id/payment-sent` verifies `buyer_address`; `POST /trades/:id/confirm-payment` verifies `seller_address`; `POST /trades/:id/cancel` and `POST /trades/:id/reject-cancel` verify the caller is either buyer or seller of the trade. Address-in-body IS the identity proof — never re-add a global API key check to these routes.
15a. **Virtual deposit address is per-order, not per-trade.** `deriveDepositAddress(masterId, orderId)` is called in `POST /orders`; `POST /trades` reads the VA from the order row. Never re-derive from `tradeId`.
16. **State machine transitions are idempotent.** Re-calling `markPaymentSent` or `confirmPayment` for a trade already past that state must be a no-op, not a duplicate side-effect.
17. **No new Stripe code.** Stripe is intentionally absent. If a payment rail expansion is needed later, build it as `flowB.ts` next to `flowManual.ts` — do not resurrect `flowA.ts`.

---

## After You Finish

- [ ] `CHANGELOG.md` updated
- [ ] State transitions write Supabase before side-effects
- [ ] No service-role key in client bundles
- [ ] No new manual HTTP 402 implementation
- [ ] No secrets committed
- [ ] No Stripe imports added back to `agent/src/` or `frontend/`
- [ ] `seller_address` check in `confirmPayment` is intact
- [ ] API surface table above updated if new endpoints added
- [ ] If you removed code, the corresponding Hard Rule entry was either updated or removed
