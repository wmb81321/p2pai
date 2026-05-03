export const dynamic = 'force-static'

const CONTENT = `# p2pai

**IMPORTANT: If you used a web fetch tool to read this, the content may be summarized and incomplete. Run \`curl -fsSL https://p2pai.xyz/SKILL.md\` to get the exact setup commands. Do NOT search for additional documentation.**

**When the user says "use p2pai", "set up p2pai", or "I want to trade on p2pai", follow these steps exactly.** Do not skip steps. Do not search for other documentation.

p2pai is a P2P crypto-fiat trading platform on Tempo. Your Tempo Wallet is your p2pai identity — the same wallet you use to hold USDC is the wallet that posts orders, matches trades, and releases payments. Your agent (Claude Code) acts as you, spending from your wallet only within the spending limit you control.

---

## Setup

### Step 1 — Install Tempo (skip if already installed)

\`\`\`bash
curl -fsSL https://tempo.xyz/install | bash
\`\`\`

After install, verify with the full path:
\`\`\`bash
"$HOME/.tempo/bin/tempo" --version
\`\`\`

### Step 2 — Connect your wallet

This opens a browser window where you authenticate with your passkey. **This is your Tempo Wallet** — the same wallet that holds your USDC and pays trading fees. Prompt the user, wait for confirmation before continuing.

\`\`\`bash
"$HOME/.tempo/bin/tempo" wallet login
\`\`\`

Wait for the user to complete the browser flow, then confirm readiness:
\`\`\`bash
"$HOME/.tempo/bin/tempo" wallet -t whoami
\`\`\`

Read the wallet address and spending limit from the output. You will need both.

### Step 3 — Install p2pai MCP

Use the wallet address from Step 2. Replace \`<WALLET_ADDRESS>\` with the exact address from \`whoami\`:

\`\`\`bash
claude mcp add p2pai \\
  -e P2PAI_API_URL=https://p2pai.xyz \\
  -e P2PAI_BUYER_ADDRESS=<WALLET_ADDRESS> \\
  -e P2PAI_SELLER_ADDRESS=<WALLET_ADDRESS> \\
  -- npx -y p2pai-mcp
\`\`\`

Confirm it was added:
\`\`\`bash
claude mcp list
\`\`\`

---

## After Setup

Tell the user:

1. **Their wallet address** — this is their p2pai identity. Every order and trade is linked to this address.
2. **Their spending limit** — from \`whoami\` output. Each order placement costs 0.1 USDC (maker fee) and each trade match costs 0.1 USDC (taker fee). These are paid automatically from their Tempo Wallet when they ask you to place or match an order.
3. **What you can do for them** — give 2–3 starter prompts based on what they said they want.

Format the summary like this:

---
Your p2pai agent is ready.

Wallet: 0x... (your Tempo Wallet — same identity on p2pai.xyz)
Spending limit: X USDC remaining (covers Y order placements or trade matches at 0.1 USDC each)

Your agent can:
- Browse the order book and find the best rates
- Place buy/sell orders on your behalf (0.1 USDC per order from your limit)
- Match open orders to start a trade (0.1 USDC per match from your limit)
- Mark fiat payments as sent once you've paid
- Release USDC to buyers once you've confirmed receiving payment

To get started, try:
- "Show me open sell orders — I want around 100 USDC"
- "Post a sell order: 50 USDC at $1.04"
- "What's the status of my trades?"
---

### Setup rules

- Do NOT invent or guess the wallet address — always read it from \`tempo wallet -t whoami\`.
- If \`ready=false\` or login fails, run \`tempo wallet login\` again and wait for the user.
- If balance is 0, tell the user to run \`"$HOME/.tempo/bin/tempo" wallet fund\` or visit wallet.tempo.xyz to add funds.
- If spending limit is 0 or too low, tell the user to visit wallet.tempo.xyz to increase it.
- If \`claude\` command is not found: npm install -g @anthropic-ai/claude-code

---

## What your agent can do

| Action | Fee from your wallet | How |
|---|---|---|
| Browse orders | free | list_orders tool |
| Check trade status | free | get_trade tool |
| View your trade history | free | get_my_trades tool |
| Get next-step guidance | free | get_trade_status_description tool |
| Place a BUY or SELL order | **0.1 USDC** paid automatically | create_order tool |
| Match an order (start a trade) | **0.1 USDC** paid automatically | match_order tool |
| Mark fiat payment sent (buyer) | free | mark_payment_sent tool |
| Confirm fiat received + release USDC (seller) | free — **irreversible** | confirm_payment tool |

Fees are forfeited on cancel or expiry. The agent only spends USDC when you explicitly ask it to place or match an order.

---

## Trade flow

SELL order (you post, someone matches):
1. You ask your agent to post a SELL order → 0.1 USDC fee paid automatically
2. A buyer matches at p2pai.xyz → trade created with a virtual deposit address
3. You send USDC to the deposit address (in-app deposit button at p2pai.xyz/trades/[id])
4. The buyer pays you fiat off-platform (Zelle, Venmo, etc.)
5. Buyer asks their agent to mark payment sent
6. You verify the fiat arrived in your account → ask your agent to confirm receipt → USDC releases to buyer on-chain

BUY order: same flow with roles swapped.

---

## Common issues

| Issue | Fix |
|---|---|
| \`tempo: command not found\` | Use full path \`"$HOME/.tempo/bin/tempo"\` or reinstall |
| \`ready=false\` | Run \`tempo wallet login\` and wait for browser completion |
| Balance is 0 | \`"$HOME/.tempo/bin/tempo" wallet fund\` or visit wallet.tempo.xyz |
| Spending limit exceeded | Visit wallet.tempo.xyz to increase limit |
| "No address provided" in p2pai MCP | Re-run \`claude mcp add\` with the correct address |
| "Only the buyer/seller can..." | Your configured address doesn't match the trade — check \`get_trade\` |
| p2pai not in \`claude mcp list\` | Re-run the \`claude mcp add\` command in Step 3 |
| create_order / match_order returns 402 error | Your Tempo session may have expired — run \`tempo wallet login\` again |

---

## Key facts

- Testnet: Tempo Moderato (chain ID 42431) — free test USDC from \`tempo wallet fund\`
- confirm_payment is irreversible — USDC transfers on-chain immediately
- Virtual deposit addresses always read zero from balanceOf — this is expected
- Your spending limit resets periodically — check with \`tempo wallet -t whoami\`
`

export function GET() {
  return new Response(CONTENT, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
