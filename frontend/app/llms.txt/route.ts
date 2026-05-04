export const dynamic = 'force-static'

const CONTENT = `# p2pai

> Agentic P2P crypto-fiat settlement on Tempo. v2.3.0 · Moderato testnet.

p2pai lets unknown counterparties trade USDC against fiat (Zelle, Venmo, CashApp, bank transfer, wire) without trusting each other or a custodian. An AI Agent coordinates settlement using Tempo Virtual Addresses for USDC escrow and direct counterparty payments for fiat. Both sides pay a 0.1 USDC service fee (maker at order creation, taker at trade creation) via HTTP 402 / mppx.

## Set up your agent (Claude Code)

One command — Claude installs Tempo CLI, opens browser auth for your Tempo Wallet,
reads your wallet address automatically, and installs the p2pai MCP:

  claude -p "Read https://p2pai.xyz/SKILL.md and set up p2pai"

Your Tempo Wallet is your p2pai identity. Your spending limit (set during Tempo login)
controls how much the agent can spend on your behalf: 0.1 USDC per order or trade match.

Then open "claude" and trade by talking.

## Context files

  SKILL.md      https://p2pai.xyz/SKILL.md        — agent setup guide (read this to bootstrap)
  llms-full.txt https://p2pai.xyz/llms-full.txt   — full API reference
  llms.txt      https://p2pai.xyz/llms.txt         — this index

## MCP server (manual install)

  npx p2pai-mcp

  env:
    P2PAI_API_URL:        https://p2pai.xyz
    P2PAI_BUYER_ADDRESS:  0x<your-wallet>
    P2PAI_SELLER_ADDRESS: 0x<your-wallet>

  claude mcp add p2pai -s user -e P2PAI_API_URL=https://p2pai.xyz -e P2PAI_BUYER_ADDRESS=0x<addr> -- npx -y p2pai-mcp

## Key pages

  /orderbook      — live BUY/SELL order book
  /trades/[id]    — trade tracker (deposit, payment, cancel, rating)
  /account        — wallet balance, faucet, payment methods, history
  /agents         — set up your personal Claude Code trading terminal

## Settlement flow (SELL order)

  1. Seller posts SELL order → pays 0.1 USDC maker fee (mppx)
  2. Buyer matches → pays 0.1 USDC taker fee (mppx) → trade created with virtual deposit address
  3. Seller sends USDC to virtual address → auto-forwards to agent master wallet
  4. Buyer pays fiat off-platform → marks payment sent (method + reference + optional proof)
  5. Seller confirms fiat received → agent releases USDC on-chain to buyer
  6. Both parties rate (1–5 stars)

BUY orders follow the same flow with roles swapped.

## MCP tools

  list_orders              — browse open orders
  get_trade                — fetch trade details and status
  get_my_trades            — trade history for a wallet
  create_order             — post a BUY or SELL order (pays maker fee)
  match_order              — match an order to create a trade (pays taker fee)
  mark_payment_sent        — buyer marks fiat sent (method + reference)
  confirm_payment          — seller confirms receipt → USDC released on-chain
  get_trade_status_description — human-readable next step for a trade

## Stack

  Blockchain:    Tempo (Moderato testnet, chain ID 42431)
  Escrow:        TIP-20 Virtual Addresses (per-order, auto-forward to master wallet)
  Fiat:          Direct counterparty — Zelle, Venmo, CashApp, bank, wire, PayPal
  Service fee:   MPP x402 via mppx (0.1 USDC maker + 0.1 USDC taker)
  Database:      Supabase Postgres + Realtime + RLS
  Frontend:      Next.js 15 on Vercel
  Agent:         TypeScript / Node.js on Railway (persistent — required for deposit monitor)
  Wallet:        Tempo Wallet (tempoWallet() wagmi connector, passkey-based)
`

export function GET() {
  return new Response(CONTENT, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
