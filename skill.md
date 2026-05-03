# p2pai

Agentic P2P crypto-fiat settlement on Tempo. An AI Agent coordinates trades between unknown counterparties using Tempo Virtual Addresses for USDC escrow and direct off-platform fiat payments (Zelle, Venmo, CashApp, bank transfer, wire). v2.3.0 · Moderato testnet.

**Frontend:** https://p2pai.xyz  
**Agent API:** https://convexo-p2p-agent-production.up.railway.app  
**Full API reference:** https://p2pai.xyz/llms-full.txt

---

## MCP install

```json
{
  "mcpServers": {
    "p2pai": {
      "command": "npx",
      "args": ["-y", "p2pai-mcp"],
      "env": {
        "P2PAI_API_URL":        "https://p2pai.xyz",
        "P2PAI_BUYER_ADDRESS":  "0x<your-wallet>",
        "P2PAI_SELLER_ADDRESS": "0x<your-wallet>"
      }
    }
  }
}
```

8 tools: `list_orders`, `get_trade`, `get_my_trades`, `create_order`, `match_order`, `mark_payment_sent`, `confirm_payment`, `get_trade_status_description`

---

## Auth model

| Endpoint | Auth |
|---|---|
| `POST /orders` | mppx x402 — 402 challenge → pay 0.1 USDC → proceeds |
| `POST /trades` | mppx x402 — 402 challenge → pay 0.1 USDC → proceeds |
| `POST /orders/:id/cancel` | `user_address` in body verified against order creator |
| `POST /trades/:id/payment-sent` | `buyer_address` in body verified against trade |
| `POST /trades/:id/confirm-payment` | `seller_address` in body verified against trade |
| `POST /trades/:id/cancel` | `canceller_address` must be buyer or seller |
| `POST /trades/:id/reject-cancel` | `rejector_address` must be the non-requester party |

**mppx client (push mode required for Tempo passkey wallets):**
```ts
import { Mppx, tempo } from 'mppx/client'
const mppx = Mppx.create({
  methods: [tempo.charge({ getClient: () => walletClient, mode: 'push' })],
  polyfill: false,
})
const res = await mppx.fetch('/api/orders', { method: 'POST', ... })
```

---

## Trade state machine

```
created → deposited → payment_sent → payment_confirmed → released → complete

Cancel paths (from created, deposited, or payment_sent):
  first party  → POST /trades/:id/cancel         → cancel_requested
  other party  → POST /trades/:id/cancel         → cancelled (no deposit)
                                                   or refunding → refunded (USDC returned)
  other party  → POST /trades/:id/reject-cancel  → reverts to prior status
```

Deposit timeout: **30 minutes** from trade creation.

---

## Key endpoints

```
POST /orders                        mppx 402 — create order + virtual deposit address
POST /orders/:id/cancel             address-verified — cancel own open order
POST /trades                        mppx 402 — match order, create trade
POST /trades/:id/payment-sent       address-verified — buyer marks fiat sent
POST /trades/:id/confirm-payment    address-verified — seller confirms → USDC released
POST /trades/:id/cancel             address-verified — mutual cancel (first or second call)
POST /trades/:id/reject-cancel      address-verified — reject cancel request
GET  /api/orders                    public — ?type=sell&status=open
GET  /api/trades/:id                public — trade details
GET  /health                        public — { status: "ok", version: "2.3.0" }
```

---

## Hard rules (do not break these)

1. **`AGENT_MASTER_ID` is sacred** — never recompute or change it per environment.
2. **USDC releases only after seller calls `confirm-payment`** — this is the trust anchor.
3. **Supabase state written BEFORE every on-chain side-effect** — crash-recoverable.
4. **`mode: 'push'` always** — Tempo passkey wallets are incompatible with pull mode.
5. **Never `balanceOf(virtualAddress)`** — always watch `Transfer` events. Virtual addresses read zero on-chain.
6. **No service-role Supabase key in browser bundles** — server-side proxy routes only.
7. **`externalId` on every mppx charge** — `orderId` for maker fee, `taker_<buyer>_<orderId>` for taker fee.

---

## Full API reference

Fetch the complete endpoint reference (request schemas, response shapes, all errors):

```
GET https://p2pai.xyz/llms-full.txt
```
