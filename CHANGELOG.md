# Changelog

## [2.4.1] — 2026-05-14

### Fixed (Security & Reliability Audit)

- **`agent/Dockerfile`** — upgraded from `node:20-slim` to `node:22-slim`; `@supabase/realtime-js` (bundled with latest `@supabase/supabase-js`) requires Node 22+ for native WebSocket — every `railway up` was failing silently with `Node.js 20 detected without native WebSocket support`
- **`flowManual.ts` — `fetchTrade`** — changed `.single()` to `.maybeSingle()` to prevent raw Supabase coerce error on missing trade; now throws a clean `Trade ${id} not found`
- **`flowManual.ts` — `confirmPayment`** — fixed crash-recovery state machine: removed premature `released` write before `transferUsdc`; `payment_confirmed` is now the stable pre-transfer checkpoint; agent restarts re-enter here and retry the transfer correctly without re-charging
- **`routes/trades.ts` — `POST /trades`** — changed `CreateTradeBody.parse()` to `.safeParse()`; bad input now returns 400 instead of throwing an unhandled error that crashed the request
- **`routes/trades.ts` — `POST /trades`** — added seller/buyer role validation against `order.user_address` by order type; prevents address spoofing where a taker could supply any `seller_address` and intercept the USDC release
- **`routes/trades.ts` — `POST /trades`** — use `matchedOrder.usdc_amount` and `matchedOrder.usd_amount` instead of body values; prevents taker from forging a lower deposit requirement to unlock a trade early
- **`routes/trades.ts` — `POST /trades`** — legacy order without virtual deposit address now re-opens the order before returning 409 (was leaving order stuck as `matched`)
- **`routes/trades.ts` — `cancel`** — order re-opens only AFTER `transferUsdc` confirms; previously re-opened before the transfer, allowing the order to be re-matched while a refund was in-flight
- **`routes/trades.ts` — `cancel`** — clears `cancel_requested_by` and `cancel_requested_from_status` on all terminal cancel states (`cancelled`, `refunded`)
- **`routes/trades.ts` — `confirm-payment`** — 404 returned when trade is not found (was 409), 403 for seller mismatch, 409 for wrong state
- **`tempo/monitor.ts`** — added `checkHistoricalDeposit()` using `getLogs({ fromBlock: 0n })` called at agent boot before starting the live watcher; fills the gap when a deposit lands while the agent is offline (`watchEvent` is forward-only and missed these)
- **`tempo/monitor.ts`** — added WARN log for under-amount deposits with tx hash and virtual address for manual recovery
- **`tempo/wallet.ts`** — added `receipt.status === 'success'` check after `waitForTransactionReceipt`; reverted on-chain transfers now throw instead of being silently treated as success
- **`lib/env.ts`** — removed dead `AGENT_API_KEY` from Zod schema; it was required at startup but never checked in any route
- **`frontend/app/api/upload-proof`** — added `trade_id` + `uploader_address` to request; route now verifies the uploader is a party to the trade before accepting the file
- **`frontend/app/api/orders/route.ts`** — removed `virtual_deposit_address`, `service_fee_paid_at`, `service_fee_tx_hash` from `PUBLIC_COLS`; internal agent fields should not be in the public order listing
- **`frontend/app/api/trades/[id]/cancel`** and **`reject-cancel`** — fixed silent error body swallowing in proxy route; errors now surface correctly to the UI
- **`frontend/app/api/orders/by-user`** and **`trades/by-user`** — normalise address to `.toLowerCase()` before DB query to match stored values
- **`frontend/components/payment-sent-form.tsx`** — added `trade_id` and `uploader_address` to upload FormData so `upload-proof` can verify party membership
- **`scripts/seller-agent.ts`** — added testnet-only safety gate (chain ID check); added `isAlreadyDeposited()` on-chain `getLogs` check before transferring to prevent double-deposit on script restart
- **`scripts/e2e-agentic.ts`** — added testnet-only safety gate
- **`mcp-server/src/index.ts`** — added actionable 402 error message in `apiFetch` with instructions for funding the agent wallet
- **Migration 012** (`supabase/migrations/012_release_tx_hash.sql`) — added `trades.release_tx_hash` column; `flowManual.ts` was already writing this field but the column was missing, causing every `confirmPayment` call to fail silently

---

## [2.4.0] — 2026-05-03

### Added
- **`/agents` page** — full Tempo-style user onboarding flow; three-tab terminal demo (Claude Code, MCP config, wallet funding); wallet-aware (shows connected address in bootstrap command)
- **`SKILL.md` route** (`p2pai.xyz/SKILL.md`) — machine-readable setup file; one command bootstraps Claude Code with MCP + wallet: `claude -p "Read https://p2pai.xyz/SKILL.md and set up p2pai. My wallet is 0x..."`
- **`llms.txt` / `llms-full.txt` routes** — LLM-optimised index and full API reference at `p2pai.xyz/llms.txt` and `p2pai.xyz/llms-full.txt`
- **`skill.md`** at repo root — enables `npx skills add wmb81321/p2pai` for persistent Claude Code context

### Updated
- Frontend domain migrated to `p2pai.xyz`
- All docs updated to reference `p2pai.xyz`
- `README.md`, `CLAUDE.md`, `ROADMAP.md` updated for Phase 12 completion and Phase 13 planning

---

## [2.3.2] — 2026-05-03

### Added
- **`scripts/e2e-agentic.ts`** (Phase 12) — full headless trade test on Moderato testnet. Seller and buyer are EOA private-key accounts. Runs all 8 steps: create SELL order (mppx maker fee), match as buyer (mppx taker fee), seller deposits USDC to virtual address, poll until deposited, mark payment sent, confirm payment, poll until complete, assert buyer balance increased. Uses `mppx/client` with `tempo.charge` pull mode (default for local EOA accounts) for the x402-gated steps.

---

## [2.3.1] — 2026-05-03

### Added
- **`scripts/seller-agent.ts`** (Phase 11) — autonomous seller agent that polls Supabase for `status = created` trades matching `SELLER_ADDRESS`, checks USDC balance, and deposits exact USDC to the virtual deposit address via viem. Mirrors the `buyer-agent.ts` polling pattern with idempotent session-level deduplication.
- **`frontend/app/llms.txt/route.ts`** and **`frontend/app/llms-full.txt/route.ts`** — static plain-text LLM context endpoints (`force-static`) following the llms.txt convention; full API reference served at `/llms-full.txt`
- **`skill.md`** at repo root — enables `npx skills add wmb81321/p2pai` for persistent Claude Code context across sessions
- **Agents page** — "Context for your LLM" section with three install options: Claude Code skill (recommended), llms-full.txt URL, MCP teaser

### Updated
- `README.md` — folder map and MCP tools table corrected to current 8 tools; Phase 11 marked complete
- `ROADMAP.md` and `CLAUDE.md` — Phase 11 marked complete; phases 12-14 remain

---

## [2.3.0] — 2026-05-03

### Removed
- **Migration 011** — dropped 10 legacy Stripe columns: `users.(stripe_account, link_payment_method_id, stripe_customer_id, stripe_buyer_pm_id, stripe_buyer_card_brand, stripe_buyer_card_last4)` and `trades.(stripe_payment_intent_id, link_spend_request_id, stripe_payout_id, stripe_account_id)`
- Orphaned pages `frontend/app/stripe/return/` and `frontend/app/stripe/payment-return/[id]/`
- Stale slash commands `.claude/commands/test-flow-a.md` and `.claude/commands/auth-stripe-link.md`

### Fixed
- **`scripts/buyer-agent.ts`** — response shape check was `data.ok` (always `undefined`); fixed to `!res.ok` only. Removed stale `Authorization: Bearer` header (endpoint uses address-in-body auth). Removed `AGENT_API_KEY` env requirement.
- **`frontend/components/agents-content.tsx`** — updated badge copy to "Moderato testnet" + fee info; phase number corrected for seller-agent.ts

### Updated
- `frontend/lib/database.types.ts` — removed legacy Stripe column types from `users` and `trades` Row shapes

---

## [2.2.1] — 2026-05-03

### Added
- **`docs/agent-api.md`** — full v2.2 API reference: all endpoints, auth model, request/response schemas, state machine diagram, mppx client setup, full trade walkthrough including mutual cancel path
- **p2pai rename** — all package names, MCP server identity, and env vars renamed from `convexo-p2p*` → `p2pai*` / `CONVEXO_*` → `P2PAI_*`
- `docs/agenticp2p.md` marked as superseded with links to current docs

---

## [2.2.0] — 2026-05-03

### Added

- **Taker fee** (`place-order-modal.tsx`, `frontend/app/api/trades/route.ts`): matching an order now requires paying 0.1 USDC via mppx push mode before the trade is created. `POST /api/trades` proxies the 402 challenge back to the browser; the client pays with `Mppx.create` + `mode: 'push'`. `externalId` format: `taker_<buyerAddress>_<orderId>` for idempotent deduplication across retries. Agent's `POST /trades` is now an mppx-gated endpoint (was address-verified only).
- **Mutual cancellation flow** (`agent/src/routes/trades.ts`, `flowManual.ts`, `trade-detail.tsx`):
  - `POST /trades/:id/cancel` redesigned: first call from either party sets status to `cancel_requested`, stores `cancel_requested_by` (the requester's address) and `cancel_requested_from_status` (the status at request time).
  - Second call from the **other** party executes the cancel: if USDC was deposited, transitions to `refunding` then refunds USDC on-chain to seller → `refunded`; if not deposited, transitions directly to `cancelled`. Order is reopened to `open` in both cases.
  - Calling cancel again as the **same** party who already requested is an idempotent no-op.
  - `POST /trades/:id/reject-cancel` (new): non-requester can reject the cancel request; trade reverts to the status stored in `cancel_requested_from_status`.
  - Trade detail page: non-requester sees a "Confirm cancellation / Reject — continue trade" panel when status is `cancel_requested`; all parties see a "Request cancellation" footer for active trades (`created`, `deposited`, `payment_sent`).
- **Image proof upload** (`frontend/components/payment-sent-form.tsx`, `frontend/app/api/upload-proof/route.ts`):
  - `PaymentSentForm` now has a click-to-upload area (drag-and-drop supported) for payment screenshots or receipts.
  - Files POSTed to `/api/upload-proof` → stored in Supabase Storage bucket `payment-proofs`; 5 MB size limit; images only (`image/*` MIME).
  - Returns a public URL written to `trades.payment_proof_url`. The existing URL paste fallback is retained for users who prefer it.
- **Migration 009** (`supabase/migrations/009_cancel_statuses.sql`): adds `cancelled` and `refunding` to the trade status enum.
- **Migration 010** (`supabase/migrations/010_cancel_columns.sql`): adds `trades.cancel_requested_by` (text), `trades.cancel_requested_from_status` (trade_status), and `cancel_requested` to the trade status enum.
- **New agent routes**: `POST /trades/:id/cancel` (redesigned mutual flow), `POST /trades/:id/reject-cancel`.
- **New frontend proxy routes**: `POST /api/trades/[id]/cancel`, `POST /api/trades/[id]/reject-cancel`, `POST /api/upload-proof`.
- **`database.types.ts` updated**: all new statuses (`cancel_requested`, `cancelled`, `refunding`, `refunded`) and cancel columns (`cancel_requested_by`, `cancel_requested_from_status`) added to `trades` Row/Insert/Update types.

---

## [2.1.3] — 2026-05-03

### Fixed

- **`PaymentMethodsEditor` stale state** (`payment-methods-editor.tsx`): `useState(initialMethods)` only captures the initial value at mount, which is `[]` before the async user fetch completes. Adding a new method would call `save([newMethod])`, overwriting existing methods. Fixed by adding `useEffect(() => { if (!adding) setMethods(initialMethods) }, [initialMethods])` to sync whenever the parent finishes loading.
- **Supabase Realtime subscription instability** (`orderbook-client.tsx`): `createClient()` was called in the component body, creating a new object on every render. Because `supabase` was in `useEffect([supabase])`, the subscription was torn down and recreated on every render, dropping all Realtime events. Fixed with `useMemo(() => createClient(), [])`.
- **Server refresh race overwriting locally-injected order** (`orderbook-client.tsx`): `useEffect([initialOrders])` was replacing state with `setOrders(initialOrders)`. If `router.refresh()` completed before the new order appeared in the Supabase query, the locally-injected order was erased. Fixed by merging: server orders replace known rows; locally-injected rows not yet in the server response are kept.

### Added

- **Migration 008** (`supabase/migrations/008_order_payment_methods.sql`): `orders.seller_payment_methods jsonb` — stores the seller's payment methods snapshotted at order creation. Private — not included in public order listing, only revealed to the matched buyer via the trade page.
- **Payment method selection in Place Order modal** (`place-order-modal.tsx`): for SELL orders, payment methods are shown as a checklist (all selected by default). The seller can uncheck individual methods before placing. Selected methods are stored with the order via `POST /orders` → agent.
- **Payment methods stored on order** (`agent/src/routes/orders.ts`): `CreateOrderBody` now accepts optional `payment_methods` array and stores it in `orders.seller_payment_methods`.
- **Trade page reads from order** (`frontend/app/trades/[id]/page.tsx`): seller payment methods are now read from `orders.seller_payment_methods` (the snapshot at order creation). Falls back to the seller's live user profile for orders created before migration 008.
- **Public order listing excludes payment info** (`frontend/app/api/orders/route.ts`): `seller_payment_methods` is explicitly excluded from all `GET /api/orders` responses; it is only accessible server-side on the trade page for the matched counterparty.

### Updated

- `agent/src/lib/schemas.ts`: moved `PaymentMethodSchema` before `OrderRowSchema` (used by both); `OrderRowSchema` extended with `seller_payment_methods`.
- `frontend/lib/database.types.ts`: `orders` Row/Insert/Update extended with `seller_payment_methods`.

## [2.1.2] — 2026-05-03

### Fixed — mppx push mode; orderbook realtime; in-app deposit

- **mppx push mode** (`place-order-modal.tsx`): switched from implicit pull mode to explicit `mode: 'push'`. Pull mode is fundamentally incompatible with Tempo passkey wallets — the wallet always adds `feePayerSignature` via its internal fee payer service, which causes `Revm error: fee payer signature recovery failed` (ECDSA cannot verify passkey signatures). Push mode lets `wallet_sendCalls` handle the full transaction lifecycle; the mppx server verifies the on-chain tx hash only.
- **Agent mppx config** (`agent/src/lib/mppx.ts`): reverted `feePayer: true` which caused `FeePayerValidationError: rejected fields: feePayerSignature`. The agent's `tempo.charge` no longer tries to co-sign a transaction that already carries the wallet's fee payer signature.
- **Supabase Realtime filter** (`orderbook-client.tsx`): removed `status=eq.open` filter from the `postgres_changes` subscription — ENUM column comparisons were silently dropping all INSERT events. Filtering is now done client-side (`order.status === 'open'`).
- **Own-order visibility**: `handleOrderCreated` now immediately fetches the newly-created order by ID via `GET /api/orders?id=<orderId>` and injects it into local state, so orders appear instantly without waiting for Realtime or a server re-render.
- **`initialOrders` prop sync**: added `useEffect` in `OrderBookClient` to sync the `initialOrders` prop to local state when `router.refresh()` triggers a server re-render.

### Added

- **In-app USDC deposit button** (`trade-detail.tsx`): sellers at `created` status now see a `DepositPanel` with a one-click "Send X USDC" button powered by `Hooks.token.useTransferSync` from `wagmi/tempo`. This triggers a Tempo-native TIP-20 transfer directly from the connected wallet to the virtual deposit address. A collapsible "Send manually" section retains the copy-address fallback. `onSuccess` triggers `poll()` so the trade status updates immediately after the on-chain transfer lands.
- **Own-order expand/cancel in orderbook**: clicking a row labeled "yours" expands it to show the virtual deposit address and a "Cancel order" button. Cancel calls `POST /api/orders/[id]/cancel` with `user_address` in body.
- **Payment methods in Place Order modal**: for SELL orders, the modal fetches the user's payment methods via `GET /api/users/me` and displays them inline (method type + value). If none are set, a warning banner with a link to `/account` is shown so sellers can add them before placing the order.
- **No-payment-method warning in orderbook**: a caution banner shown when the connected wallet has an open SELL order but no payment methods registered.

## [2.1.1] — 2026-05-03

### Changed — open auth model + balance fix

- **No global Bearer gate.** All payment endpoints now use address-in-body identity verification instead of `AGENT_API_KEY`. `POST /orders/:id/cancel` checks `requester_address` against `order.creator_address`; `POST /trades/:id/payment-sent` checks `buyer_address`; `POST /trades/:id/confirm-payment` checks `seller_address`. `POST /trades/:id/settle` retains Bearer auth (deprecated endpoint).
- **Balance hook simplified.** `useWalletBalances` (4-token flatMap) replaced with `usePathUsdBalance` — a single `Hooks.token.useGetBalance` call for pathUSD, identical pattern to `balance-display.tsx`. Error state now surfaces as `—` instead of being silently absorbed into an empty array.
- `frontend/hooks/use-wallet-balances.ts` — exports `usePathUsdBalance`, `PATHUSDC_ADDRESS`, `PATHUSDC_DECIMALS`. Old `useWalletBalances` export removed.
- `frontend/app/account/account-client.tsx` — balance section shows three explicit states: `···` (loading), `—` (error), `"X.XX pathUSD"` (success). Faucet button always visible.

## [2.1.0] — 2026-05-03

### Changed — x402 fee moved to order creation (per-order virtual address)

- **Service fee gate moved**: 0.1 USDC x402 charge now happens at `POST /orders` (order creation) instead of `POST /trades/:id/settle`. The order creator pays once; fee is forfeited on cancel or expiry.
- **Virtual deposit address is now per-order** (derived from `orderId`), not per-trade. The VA is written to `orders.virtual_deposit_address` at creation time; `POST /trades` reads it from the order row at match time.
- `POST /orders` is now the public mppx-gated endpoint (payment = auth). `POST /trades/:id/settle` is now Bearer-authed and fee-free (deprecated; kept for backward compat with existing agent scripts).
- `POST /orders/:id/cancel` (Bearer auth, owner-only) cancels an order DB-only; the on-chain VA persists, the 0.1 USDC fee is forfeited.
- `deriveDepositAddress(masterId, entityId)` — param renamed from `tradeId` to `entityId`.
- `chargeServiceFee(req, res, externalId)` — param renamed from `tradeId` to `externalId`.

### Added

- `supabase/migrations/007_order_deposit_address.sql` — adds `orders.virtual_deposit_address` (unique), `orders.service_fee_paid_at`, `orders.service_fee_tx_hash`; expires all legacy `open` orders with null VA.
- `agent/src/routes/orders.ts` — `POST /orders` (mppx x402 gate) and `POST /orders/:id/cancel` (Bearer auth).
- `frontend/app/api/orders/[id]/cancel/route.ts` — cancel proxy forwarding to agent with Bearer auth.
- `mppx` added to `frontend/package.json` (v0.6.8) for browser-side 402 payment flow.

### Fixed

- `frontend/lib/wagmi.ts` — `tempoWallet` now imported from `wagmi/connectors` (docs-correct) instead of `wagmi/tempo`.
- `frontend/hooks/use-wallet-balances.ts` — new `useWalletBalances` hook calls `wallet_getBalances` RPC to return all token balances (pathUSD, AlphaUSD, BetaUSD, ThetaUSD), matching the full balance view in wallet.tempo.xyz.
- `frontend/app/account/account-client.tsx` — balance section replaced: now shows every token balance returned by `wallet_getBalances` instead of pathUSD only; faucet refetch triggers a full wallet balance refresh.

### Updated

- `frontend/app/api/orders/route.ts` — POST handler now proxies to agent with transparent 402 passthrough instead of writing Supabase directly.
- `frontend/components/place-order-modal.tsx` — uses `mppx/client` (`Mppx.create` + `tempo.charge`) for automatic 402 payment; balance check includes the 0.1 USDC fee; UI copy updated with fee disclosure and non-refundable warning.
- `agent/src/lib/router.ts` — `/orders` (POST) is the new mppx-exempt endpoint; `/trades/:id/settle` moved to Bearer-auth.
- `agent/src/index.ts` — registers `registerOrderRoutes`; version bumped to `2.1.0`.
- `agent/src/lib/schemas.ts` — `OrderRowSchema` extended with `virtual_deposit_address`, `service_fee_paid_at`, `service_fee_tx_hash`.
- `frontend/lib/database.types.ts` — `orders` Row/Insert/Update types extended with new columns.

### Docs

- `CLAUDE.md` — full v2.0.0 rewrite: build status table, folder structure, stack, state machine, flow narrative, API surface, hard rules all aligned to direct-counterparty payment model.
- `CLAUDE.local.md` — refreshed to v2.0.0; removed Stripe webhook relay docs; added explicit "known stale items / cleanup queue" so the next pass has a clear backlog.
- `.claude/rules/stripe-integration.md` — replaced with a brief v2.0 deprecation note pointing at `flowManual.ts`.
- `.claude/rules/testing-practices.md` — Stripe-specific test rules removed; new section for the manual flow's seller-confirmation invariant and the unchanged idempotency rules.
- `.claude/rules/coding-style.md` — `flows/` example updated from `flowA.ts/flowB.ts` to `flowManual.ts`; validation rule no longer references Stripe webhooks.
- `.claude/rules/x402-patterns.md` — clarified that the settle endpoint marks `payment_sent` only (no longer "drives full settlement"); removed stale "fee → SPT → release" wording.
- `.claude/rules/tempo-patterns.md` — left intact (still accurate for v2.0).

## [2.0.0] — 2026-05-02

### Changed — Stripe removed, direct counterparty payments

- **Removed Stripe entirely** as the fiat payment rail (Connect, PaymentElement, Stripe Link, Global Payouts, webhooks).
- **New trade state machine**: `created → deposited → payment_sent → payment_confirmed → released → complete` (with `disputed` added alongside `deposit_timeout` / `refunded` as failure modes).
- Counterparties now pay each other directly (Zelle, Venmo, bank transfer, wire, etc.).
- Seller adds payment methods on `/account`; buyer sees them on the trade page.
- Buyer marks payment sent with method + reference number + optional proof URL.
- Seller confirms receipt → agent releases USDC on-chain (unchanged Tempo signing path).
- Trust model: the seller's confirmation is the new release trigger, replacing Stripe's signed webhook. Ratings are the long-term reputation feedback loop.

### Added

- `supabase/migrations/006_manual_payment.sql` — new trade statuses (`payment_sent`, `payment_confirmed`, `disputed`); `trades.payment_method`, `payment_reference`, `payment_proof_url`, `payment_sent_at`, `payment_confirmed_at`; `users.payment_methods` jsonb (default `[]`).
- `agent/src/flows/flowManual.ts` — `markPaymentSent()` and `confirmPayment()`. `confirmPayment` enforces `confirmerAddress === trade.seller_address` before any state mutation or on-chain call.
- `POST /trades/:id/payment-sent` (Bearer auth) — buyer marks fiat sent.
- `POST /trades/:id/confirm-payment` (Bearer auth) — seller confirms receipt; writes `payment_confirmed` then `released` to Supabase, then transfers USDC on-chain, then writes `complete`.
- `POST /api/users/payment-methods` — save/replace per-user payment methods array (max 10).
- `PaymentSentForm` component — method selector (Zelle / Venmo / CashApp / Bank Transfer / Wire / Other) + reference + optional proof URL.
- `ConfirmPaymentPanel` component — seller view with buyer's payment details + confirm button that calls the agent.
- `PaymentMethodsEditor` component — `/account` UI to list/add/remove payment methods (Zelle / Venmo / CashApp / Bank Transfer / Wire / PayPal / Other).
- MCP server v2.0.0 — `mark_payment_sent` and `confirm_payment` tools; `settle_trade` now documents that it marks `payment_sent` and still requires `confirm_payment` to release USDC.
- `agent/src/index.ts` — version bumped to `2.0.0` in the `/health` payload; route log lines now print `payment-sent` / `confirm-payment`.

### Kept

- `POST /trades/:id/settle` (public, mppx x402) — agent-native path: pay 0.1 USDC fee → mark `payment_sent` with `method='x402'`. Releasing USDC still requires the seller to call `/confirm-payment`.
- mppx service fee infrastructure (`MPP_SECRET_KEY`, `CHARGE_AMOUNT_USDC`, `agent/src/lib/mppx.ts`).
- Tempo Virtual Addresses, deposit monitor, on-chain USDC release (unchanged).
- `FACILITATOR_URL` proxy and `AGENT_API_KEY` Bearer auth on all non-public agent routes.
- Ratings (`POST /api/trades/[id]/rate`).

### Removed

- `agent/src/stripe/` — `client.ts`, `payouts.ts`, `webhook.ts` deleted.
- `agent/src/lib/link.ts` — Stripe Link CLI wrapper deleted.
- `agent/src/routes/webhooks.ts` — Stripe webhook route deleted; agent no longer mounts a `/webhooks/stripe` endpoint.
- `agent/src/flows/flowA.ts` — Stripe-based settlement orchestrator deleted.
- `stripe` npm dependency removed from `agent/package.json`.
- Stripe Connect onboarding, SetupIntent card save, off-session charges.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_API_VERSION`, `LINK_CLI_AUTH`, `LINK_DEFAULT_PM_ID` env vars (no longer read by anything).
- MCP tool `initiate_payment` → replaced by `mark_payment_sent` + `confirm_payment`.

### Stubbed (return `410 Gone` so old clients fail loudly)

- `POST /api/stripe/account`
- `GET  /api/stripe/account-status`
- `GET  /api/stripe/account/refresh`
- `POST /api/stripe/setup-intent`
- `POST /api/stripe/payment-method/save`
- `POST /api/users/link-pm` and `DELETE /api/users/link-pm`
- `POST /api/trades/[id]/link-pay`
- `POST /api/trades/[id]/auto-pay`
- `POST /api/trades/[id]/payment-intent`

Old Stripe React components (`BuyerPaymentForm`, `LinkPayButton`, `LinkPmSetup`, `SaveCardForm`, `StripeConnectButton`) are stubbed with `export {}` to keep imports compiling while flagging that the components are gone.

### Deployments

- **Railway agent v2.0.0** live at `https://convexo-p2p-agent-production.up.railway.app`.
- **Vercel frontend** deploying from commit `b1b8657`.
- Stripe webhook endpoint `we_1TSOSkIeMhBdGlf7tM8ekyQI` is no longer routed to anything — safe to delete from the Stripe dashboard.

## [1.4.0] — 2026-05-01
### Phase 8 — MCP server, /agents page, public orders GET, settle_trade tool

- **`mcp-server/`** — new `convexo-p2p-mcp` npm package: a Node.js MCP server (stdio transport) wrapping the Convexo REST API so any Claude agent can add it to their `mcp.json` and become a buyer or seller autonomously; exposes 8 tools: `list_orders`, `get_trade`, `get_my_trades`, `create_order`, `match_order`, `initiate_payment`, `settle_trade`, `get_trade_status_description`.
- **`settle_trade` tool** — crypto-native settlement path: agent pays 0.1 USDC service fee via MPP (`POST /api/trades/:id/settle`); the mppx payment IS the authorization — no Stripe, no API key required. Alternative to `initiate_payment` for on-chain-only flows.
- **`GET /api/orders`** — public read endpoint added to the existing orders route; supports `?type=`, `?status=`, and `?id=` query params; returns up to 100 orders via service-role client (bypasses RLS for public read).
- **`/agents` page** — developer-facing page (`frontend/app/agents/page.tsx` + `AgentsContent` client component) explaining how to add the MCP server, listing all 8 tools with role badges, showing an example agent conversation, and linking to the direct REST API.
- **Nav** — "For Agents" link added to the main header.

## [1.3.0] — 2026-05-01
### Phase 7b — Per-buyer Stripe Link (P2P payment infrastructure)

- **Per-buyer Link PM registration** — `LinkPmSetup` component on account page; buyer runs `npx @stripe/link-cli payment-methods list`, pastes their `csmrpd_...` ID; stored in `users.link_payment_method_id`
- **`POST /api/users/link-pm`** — saves/removes buyer's Link PM ID; validates `csmrpd_` prefix
- **Agent link-pay fixed** — removed `LINK_DEFAULT_PM_ID` platform fallback; now requires buyer's own PM; returns 402 with clear action message if not registered
- **`LinkPayButton` restored** — now targets buyer's own PM, not platform's; polls trade status every 4s to auto-advance UI on approval; shows clean approval URL for agent consumption
- **`buyer-agent.ts` updated** — calls link-pay (not auto-pay); logs spend request ID + approval URL; `AUTO_APPROVE=1` opens URL in local browser for semi-automated testing

## [1.2.0] — 2026-05-01
### Phase 7 — Agentic buyer payments (per-buyer Stripe, off-session auto-pay)

- **Removed `LinkPayButton`** — was charging platform owner's card; replaced by per-buyer card system
- **`SaveCardForm` component** — Stripe Elements SetupIntent UI on account page; saves card for future off-session charges; shows saved card brand + last4 once stored
- **`POST /api/stripe/setup-intent`** — creates (or retrieves) a Stripe Customer per buyer, returns SetupIntent `clientSecret`
- **`POST /api/stripe/payment-method/save`** — stores PM ID + card brand/last4 in `users` table after setup completes
- **`POST /api/trades/[id]/auto-pay`** — off-session charge: reads buyer's saved Customer + PM, creates `{ confirm: true, off_session: true }` PaymentIntent; `payment_intent.succeeded` triggers existing Flow A
- **`GET /api/users/me`** — returns buyer payment method details (card brand/last4) for account page display
- **`scripts/buyer-agent.ts`** — autonomous buyer agent script: polls Supabase for `deposited` trades where wallet is buyer, calls auto-pay for each; runs as a standalone loop or inside a Claude SDK agent tool
- **DB migration `005`** — `users.stripe_customer_id`, `stripe_buyer_pm_id`, `stripe_buyer_card_brand`, `stripe_buyer_card_last4`

## [1.1.0] — 2026-05-01
### Phase 6 — Stripe Link SPT buyer payment

- **`LinkPayButton`** — "Pay with Stripe Link" button on the trade detail page; creates a Link spend request server-side, shows approval URL, polls in background, confirms payment on approval; falls back to existing Stripe Elements form
- **`POST /trades/:id/link-pay`** (agent) — creates Link spend request (`card` credential type, `--test` in test mode); on approval retrieves raw card, creates Stripe PaymentMethod + confirms PaymentIntent server-side; `payment_intent.succeeded` webhook triggers existing Flow A
- **`POST /api/trades/[id]/link-pay`** (Next.js proxy) — forwards to agent with `AGENT_API_KEY` auth
- **`initLinkCli()`** — writes `LINK_CLI_AUTH` env JSON to `~/.config/link-cli-nodejs/config.json` at agent startup so the `link-cli` binary authenticates on Railway
- **Dockerfile** — adds `npm install -g @stripe/link-cli`
- **DB migration `004`** — `trades.link_spend_request_id`, `users.link_payment_method_id`
- **`LINK_CLI_AUTH`** and **`LINK_DEFAULT_PM_ID`** added to agent env schema (optional — app degrades gracefully without them)

## [1.0.2] — 2026-05-01
### Bug fixes — P1 audit fixes

- **`stripe_payment_intent_id` migration**: added `ALTER TABLE trades ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text` as `003_stripe_payment_intent.sql`; column was used by the payment-intent route but never existed in production schema
- **seller `charges_enabled` check**: `POST /api/trades/[id]/payment-intent` now retrieves the seller's Stripe Connect account and returns 409 if `charges_enabled` is false before creating the PaymentIntent
- **webhook error instanceof**: replaced fragile error-message regex in `agent/src/routes/webhooks.ts` with `err instanceof Stripe.errors.StripeSignatureVerificationError` for reliable 400 vs 500 discrimination

## [1.0.1] — 2026-05-01
### Bug fixes — P0/P1 audit fixes

- **env**: Fix `NEXT_PUBLI_TEMPO_PATHUSDC_ADDRESS` typo → `NEXT_PUBLIC_TEMPO_PATHUSDC_ADDRESS`; add `TEMPO_PATHUSDC_ADDRESS` for agent; add `TEMPO_RPC_URL` for agent; fix RPC URL to Moderato testnet
- **balance display**: `Hooks.token.useGetBalance` query now gated on `!!PATHUSDC` so it never fires with undefined token
- **account page orders/trades**: replaced direct browser Supabase queries (blocked by RLS) with `GET /api/orders/by-user` and `GET /api/trades/by-user` (service-role, bypasses RLS) — fixes empty order/trade history
- **orderbook page**: server-component initial fetch now uses `createServerClient()` (service-role) instead of browser anon client
- **orders API**: upsert user row before inserting order to prevent FK constraint violation on first order placement
- **agent trades route**: upsert both buyer and seller rows before inserting trade
- **deposit monitor**: watchers now run in parallel (`Promise.all`) instead of sequentially; expired deadlines are marked immediately without starting a watcher
- **stripe refresh**: added `GET /api/stripe/account/refresh` route so abandoned Stripe onboarding can resume cleanly

## [1.0.0] — 2026-05-01
### Complete — All MVP phases shipped

**Phase 5 — BUY order matching + ratings**
- **BUY order matching** — order book Match button now works on BUY orders. Matcher becomes the seller (deposits USDC, receives USD); order poster is the buyer (pays USD, receives USDC). Roles derived automatically from order type in `matchOrder()`.
- **Contextual button labels** — "Buy" on sell-order rows, "Sell" on buy-order rows for clarity.
- **Ratings** — 1–5 star widget with optional comment on trade detail page, shown after `released` or `complete`. Submits to `POST /api/trades/[id]/rate`. Upserts into `ratings` table (unique constraint on `trade_id, rater_address`), recomputes `users.rating_avg`.
- **Trade completion** — agent now advances trade to `complete` immediately after releasing USDC on-chain (no longer stuck at `released`).
- **Seller waiting state** — trade detail now shows pulsing hint to seller while buyer hasn't paid yet.
- **`database.types.ts`** — added `rating_avg` and `trade_count` to `users.Update` type.

**Phase 4 — Stripe PaymentElement + buyer payment flow**
- **`BuyerPaymentForm`** — Stripe Elements with `PaymentElement`; dark theme; fetches `clientSecret` on mount; confirms payment with redirect to `/stripe/payment-return/[tradeId]`.
- **`/api/trades/[id]/payment-intent`** — creates Stripe PaymentIntent for `usd_amount * 100 + 10` cents; idempotent (retrieves existing PI if already created); stores `stripe_payment_intent_id` on trade row.
- **`/stripe/payment-return/[id]`** — Stripe return page using `useSearchParams` inside Suspense boundary; shows success/fail state.
- **`payment_intent.succeeded` handler** — registered in `registerFlowAHandlers`; reads `trade_id` from PI metadata; calls `continueAfterFeePaid()`.
- **`continueAfterFeePaid` broadened** — accepts both `deposited` (PaymentElement path) and `fee_paid` (legacy mppx path) as valid entry states.
- **`stripe_payment_intent_id`** — added to `TradeRowSchema` (agent) and `database.types.ts` (frontend).

**Phase 3b — Account page**
- **`/account`** — wallet address (copy), USDC balance, Stripe Connect status, Stripe Link placeholder ("coming soon"), Deposit/Withdraw section, open orders table, trade history with role detection (buyer/seller).
- **Layout nav** — Order Book and Account links added to header.

**Phase 3a — Order book UI rewrite**
- **Filter tabs** — All / Buy / Sell with live counts replace the Bids/Asks two-column grid.
- **Inline toolbar** — "+ New Order" button at top-right; no more `fixed bottom-8 right-8` floating button.
- **Unified table** — Type badge (green SELL / yellow BUY), USDC, USD, Rate, action column.
- **Order placement feedback** — `placed` state in `PlaceOrderModal`; green "✓ Order placed" shown for 2s before close.

**Phase 3 — Stripe Connect for sellers**
- **`StripeConnectButton`** — checks status via `/api/stripe/account-status`; shows Connect / Complete / Connected states.
- **`/api/stripe/account`** — creates Stripe Express account without `capabilities` (onboarding handles it) and without country hardcode (any country works).
- **`/api/stripe/account-status`** — returns `{ connected, details_submitted }`.
- **upsert fix** — `/api/users/upsert` uses `ignoreDuplicates: true` to never overwrite `stripe_account` on reconnect.

**Phase 2 — Frontend API proxy routes**
- `POST /api/trades` — creates trade via agent, returns `trade_id` and `virtual_deposit_address`.
- `GET /api/trades/[id]` — fetches trade from Supabase (direct, no agent hop).
- `POST /api/trades/[id]/settle` — forwards to agent mppx 402 gate.
- `POST /api/orders` — creates order in Supabase via service-role client.

**Balance + faucet improvements**
- **`BalanceDisplay`** — switched from `useReadContract` + ERC-20 ABI to `Hooks.token.useGetBalance` from `wagmi/tempo` for reliable TIP-20 reads.
- **In-app faucet** — `Hooks.faucet.useFundSync` "+" testnet button on Account page; no redirect to wallet.tempo.xyz required.
- **`tempoxyz/docs` skill** — installed at `.agents/skills/tempo-docs` via `npx skills add tempoxyz/docs`.

## [0.7.0] — 2026-05-01
### Security — Phase 0: agent auth + atomic trade creation

- **`AGENT_API_KEY` bearer auth** — all Railway agent routes except `/health` and `/webhooks/stripe` require `Authorization: Bearer <AGENT_API_KEY>`; returns 401 otherwise.
- **Race condition fixed** — `POST /trades` atomically updates the order from `open → matched` with `WHERE status = 'open'` before creating the trade. Concurrent match returns 409.
- **`virtual_deposit_address` placeholder eliminated** — trade UUID generated client-side, virtual address derived off-chain, both written in a single atomic INSERT.

### Fixed — Vercel deployment + frontend chain config

- **`frontend/package-lock.json` deleted** — caused Vercel to switch package managers and only install 23/46 packages.
- **`frontend/vercel.json` installCommand** — `cd .. && pnpm install --frozen-lockfile`.
- **`frontend/lib/wagmi.ts` chain fixed** — `tempoModerato` (chain ID 42431) instead of `tempo` (mainnet 4217).

## [0.6.0] — 2026-05-01
### Added — Phase 1: frontend wallet auth + user provisioning

- `frontend/components/connect-button.tsx` — `tempoWallet()` connect/disconnect button; fires `POST /api/users/upsert` on first connect.
- `frontend/app/api/users/upsert/route.ts` — service-role upsert with `ignoreDuplicates: true`.
- `frontend/lib/supabase-server.ts` — service-role Supabase client for server-only routes.
- `frontend/lib/database.types.ts` — fixed `Relationships: []` and missing Views/Functions required by `@supabase/postgrest-js` v2.

## [0.5.2] — 2026-05-01
### Added / Fixed — Railway GitHub integration + Flow A E2E on production

- Railway connected to GitHub (`wmb81321/onix`, root `/agent`, Dockerfile builder).
- `agent/Dockerfile` COPY paths corrected for Railway's root dir build context.
- `MPP_SECRET_KEY` and `TEMPO_TESTNET_RPC_URL` added to Railway env.
- **Flow A E2E confirmed on Railway** — `transfer.paid` → USDC release (tx `0xb8d589db...`, Moderato).
- `frontend/vercel.json` created for Vercel GitHub integration.

## [0.5.1] — 2026-05-01
### Fixed — Flow A test run + API corrections

- `agent/src/lib/mppx.ts` — corrected mppx v0.6.8 import path (`mppx/server`); switched `tempo()` → `tempo.charge()`.
- `agent/src/routes/webhooks.ts` — fixed 400/500 status discrimination for Stripe signature errors.
- `nixpacks.toml` — empty build phase to bypass nixpacks TypeScript compilation.

## [0.5.0] — 2026-05-01
### Added — Flow A settlement agent

- `agent/src/lib/env.ts`, `schemas.ts`, `router.ts`, `mppx.ts`, `supabase.ts`
- `agent/src/tempo/wallet.ts`, `monitor.ts`, `chain.ts`, `virtualAddresses.ts`
- `agent/src/stripe/client.ts`, `payouts.ts`, `webhook.ts`
- `agent/src/flows/flowA.ts` — full crypto→fiat orchestrator
- `agent/src/routes/trades.ts`, `webhooks.ts`
- `agent/src/index.ts` — fully wired HTTP server

## [0.4.0] — 2026-05-01
### Completed — Infrastructure fully operational

- Tempo Virtual Address master registered on-chain (`AGENT_MASTER_ID=0x3ead6d3d`, block 15460573)
- Railway agent live at `https://convexo-p2p-agent-production.up.railway.app`
- Stripe webhook registered (live mode)
- Supabase schema + RLS applied to production

## [0.3.0] — 2026-05-01
### Fixed — Build errors + architecture corrections

- Node.js `createServer` instead of Bun; corrected `ox/tempo` API; `tempoWallet` from `wagmi/tempo`; `wagmi` upgraded to v3.

## [0.2.0] — 2026-04-30
### Changed — Architecture pivot

- Privy → Tempo Wallet; custom Solidity escrow → Tempo Virtual Addresses; ERC-8004/TEE/Solidity removed from MVP; MPP via `mppx` replaces custom x402 MCP.

## [0.1.0] — 2026-04-30
### Added — Initial scaffold

- CLAUDE.md, CLAUDE.local.md, mcp.json, .env.example
- `.claude/settings.json`, rules, commands, hooks
- `.agents/skills/`: stripe-best-practices, create-payment-credential, tempo-docs, privy, x402
- MCP: stripe, link, tempo, privy-docs connected
