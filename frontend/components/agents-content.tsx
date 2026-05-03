'use client'

import { useState } from 'react'
import { useAccount, useConnect } from 'wagmi'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="font-mono text-[10px] text-dim hover:text-ink transition-colors px-2 py-1 rounded border border-white/[0.07] hover:border-white/20 shrink-0"
    >
      {copied ? 'copied!' : 'copy'}
    </button>
  )
}

function CodeBlock({ text }: { text: string }) {
  return (
    <div className="relative bg-canvas rounded-xl border border-white/[0.07] p-4">
      <div className="absolute top-3 right-3">
        <CopyButton text={text} />
      </div>
      <pre className="font-mono text-[12px] text-ink/80 overflow-x-auto whitespace-pre pr-14">{text}</pre>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[10px] text-dim/50 uppercase tracking-widest mb-4">{children}</p>
}

// ---------------------------------------------------------------------------
// Terminal — realistic Claude Code session lines
// ---------------------------------------------------------------------------

type TermLine =
  | { kind: 'prompt';  text: string }
  | { kind: 'action';  text: string }
  | { kind: 'tool';    name: string; args?: string }
  | { kind: 'result';  text: string; lines?: string[] }
  | { kind: 'reply';   text: string; lines?: string[] }
  | { kind: 'divider'; label: string }
  | { kind: 'note';    text: string }

function Terminal({ lines }: { lines: TermLine[] }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-canvas overflow-hidden">
      {/* window chrome */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/[0.07] bg-white/[0.02]">
        <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
        <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
        <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
        <span className="font-mono text-[10px] text-dim/30 ml-2">claude</span>
      </div>
      <div className="p-4 space-y-1.5 overflow-x-auto">
        {lines.map((line, i) => {
          if (line.kind === 'divider') {
            return (
              <div key={i} className="flex items-center gap-3 py-2">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="font-mono text-[10px] text-dim/40 shrink-0">{line.label}</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>
            )
          }
          if (line.kind === 'note') {
            return (
              <p key={i} className="font-mono text-[11px] text-dim/40 italic pl-2">{line.text}</p>
            )
          }
          if (line.kind === 'prompt') {
            return (
              <div key={i} className="flex items-start gap-2 pt-2">
                <span className="font-mono text-[12px] text-accent shrink-0 mt-0.5">›</span>
                <span className="font-mono text-[12px] text-ink">{line.text}</span>
              </div>
            )
          }
          if (line.kind === 'action') {
            return (
              <div key={i} className="flex items-start gap-2">
                <span className="font-mono text-[11px] text-dim/40 shrink-0 mt-0.5">⏺</span>
                <span className="font-mono text-[12px] text-dim/70">{line.text}</span>
              </div>
            )
          }
          if (line.kind === 'tool') {
            return (
              <div key={i} className="flex items-start gap-2 pl-4">
                <span className="font-mono text-[11px] text-accent/50 shrink-0 mt-0.5">⏺</span>
                <span className="font-mono text-[12px]">
                  <span className="text-accent">{line.name}</span>
                  {line.args && <span className="text-dim/50">({line.args})</span>}
                </span>
              </div>
            )
          }
          if (line.kind === 'result') {
            return (
              <div key={i} className="pl-8">
                {line.text && (
                  <span className="font-mono text-[11px] text-dim/50 block">⎿ {line.text}</span>
                )}
                {line.lines?.map((l, j) => (
                  <span key={j} className="font-mono text-[11px] text-dim/40 block pl-3">{l}</span>
                ))}
              </div>
            )
          }
          if (line.kind === 'reply') {
            return (
              <div key={i} className="pl-2 py-1 space-y-0.5">
                {line.text && (
                  <p className="font-mono text-[12px] text-ink/80">{line.text}</p>
                )}
                {line.lines?.map((l, j) => (
                  <p key={j} className="font-mono text-[12px] text-ink/80">{l}</p>
                ))}
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Flow data
// ---------------------------------------------------------------------------

const SETUP_LINES: TermLine[] = [
  { kind: 'prompt', text: 'Read https://p2pai.xyz/SKILL.md and set up p2pai' },
  { kind: 'action', text: 'Fetching p2pai setup guide...' },
  { kind: 'tool',   name: 'Fetch', args: 'https://p2pai.xyz/SKILL.md' },
  { kind: 'result', text: 'Received 3.2KB (200 OK)' },
  { kind: 'action', text: 'Step 1 — Installing Tempo CLI' },
  { kind: 'tool',   name: 'Bash', args: 'curl -fsSL https://tempo.xyz/install | bash' },
  { kind: 'result', text: 'Tempo v1.6.0 installed at ~/.tempo/bin/tempo' },
  { kind: 'action', text: 'Step 2 — Connecting your wallet (browser will open)' },
  { kind: 'tool',   name: 'Bash', args: '"$HOME/.tempo/bin/tempo" wallet login' },
  { kind: 'result', text: 'Auth URL: https://wallet.tempo.xyz/cli-auth?code=8K2XMQPT', lines: [
    '  Waiting for browser authentication...',
    '  ✓ Authenticated',
  ]},
  { kind: 'action', text: 'Step 3 — Reading wallet address and spending limit' },
  { kind: 'tool',   name: 'Bash', args: '"$HOME/.tempo/bin/tempo" wallet -t whoami' },
  { kind: 'result', text: 'ready: true', lines: [
    '  wallet:          "0x512c384e6648daed20793bc41142dc91f7a8b0bd"',
    '  balance:         2.50 USDC (available)',
    '  spending_limit:  10.00 USDC remaining',
  ]},
  { kind: 'action', text: 'Step 4 — Installing p2pai MCP with your wallet address' },
  { kind: 'tool',   name: 'Bash', args: 'claude mcp add p2pai -e P2PAI_BUYER_ADDRESS=0x512c... -- npx -y p2pai-mcp' },
  { kind: 'result', text: 'MCP server "p2pai" added' },
  { kind: 'reply',  text: 'Your p2pai agent is ready.', lines: [
    '',
    '  Wallet:         0x512c384e...dc91f7a8b0bd',
    '  Balance:        2.50 USDC',
    '  Spending limit: 10.00 USDC (covers up to 50 order/trade actions at 0.1 USDC each)',
    '',
    'Your agent acts as you — your wallet, your trades, your limits.',
    'Try: "Show me open sell orders" or "Post a sell order: 100 USDC at $1.04"',
  ]},
]

const BUY_LINES: TermLine[] = [
  { kind: 'divider', label: 'new session — claude' },
  { kind: 'prompt',  text: 'I want to buy 100 USDC, find me a good deal' },
  { kind: 'tool',    name: 'list_orders', args: 'type: "sell"' },
  { kind: 'result',  text: '3 open sell orders:', lines: [
    '  ord_a1b2  100 USDC  @ $1.04/USDC = $104.00  ·  Zelle, Venmo',
    '  ord_c3d4   50 USDC  @ $1.05/USDC =  $52.50  ·  Bank transfer',
    '  ord_e5f6  200 USDC  @ $1.06/USDC = $212.00  ·  Zelle',
  ]},
  { kind: 'reply',   text: 'Best rate is ord_a1b2 — 100 USDC for $104 via Zelle or Venmo.', lines: [
    'Match it? That spends 0.1 USDC from your limit (9.9 USDC remaining after).',
  ]},
  { kind: 'prompt',  text: 'Yes, match it' },
  { kind: 'tool',    name: 'match_order', args: 'order_id: "ord_a1b2"' },
  { kind: 'result',  text: 'Trade created:', lines: [
    '  trade_id:          trd_7x8y9z',
    '  deposit_deadline:  30 minutes',
    '  seller pays via:   Zelle (+1-555-0182), Venmo (@maria-s)',
  ]},
  { kind: 'reply',   text: 'Trade started! Here\'s what happens next:', lines: [
    '',
    '  1. The seller deposits 100 USDC — they have 30 min',
    '  2. You send $104 to the seller: Zelle +1-555-0182 or Venmo @maria-s',
    '  3. Tell me the confirmation number and I\'ll mark it paid',
    '  4. The seller confirms receipt → your 100 USDC releases on-chain',
  ]},
  { kind: 'prompt',  text: 'Sent $104 via Venmo to @maria-s, reference #VNM-2847563' },
  { kind: 'tool',    name: 'mark_payment_sent', args: 'trade_id: "trd_7x8y9z", method: "Venmo", ref: "#VNM-2847563"' },
  { kind: 'result',  text: '{ status: "payment_sent" }' },
  { kind: 'reply',   text: 'Done — seller notified. Waiting for them to confirm.', lines: [
    'I\'ll track it. Ask me "what\'s the status of trd_7x8y9z" anytime.',
  ]},
  { kind: 'note',    text: '[ seller confirms in their app ]' },
  { kind: 'prompt',  text: 'Any update on my trade?' },
  { kind: 'tool',    name: 'get_trade_status_description', args: 'trade_id: "trd_7x8y9z"' },
  { kind: 'result',  text: 'status: "complete"', lines: [
    '  Seller confirmed receipt. USDC released on-chain to buyer.',
  ]},
  { kind: 'reply',   text: '100 USDC is in your wallet. Trade complete.' },
]

const SELL_LINES: TermLine[] = [
  { kind: 'divider', label: 'new session — claude' },
  { kind: 'prompt',  text: 'Post a sell order: 100 USDC at $1.05' },
  { kind: 'tool',    name: 'create_order', args: 'type: "sell", usdc_amount: 100, rate: 1.05' },
  { kind: 'result',  text: 'Order created:', lines: [
    '  order_id:              ord_9z8y7x',
    '  usd_amount:            $105.00',
    '  virtual_deposit:       0xc4fe...a912  ← send your USDC here',
    '  maker fee paid:        0.1 USDC',
  ]},
  { kind: 'reply',   text: 'Order is live on the book. Next:', lines: [
    '  → Deposit 100 USDC to 0xc4fe...a912 to activate it',
    '    (use the deposit button at p2pai.xyz/orderbook or in-app)',
    '  → When someone matches, I\'ll walk you through the rest',
  ]},
  { kind: 'note',    text: '[ seller deposits USDC · buyer matches the order ]' },
  { kind: 'prompt',  text: 'Someone matched my order — what do I do?' },
  { kind: 'tool',    name: 'get_my_trades', args: '' },
  { kind: 'result',  text: '1 active trade:', lines: [
    '  trd_4a5b6c  ·  status: deposited  ·  buyer owes you $105 via Zelle or Venmo',
  ]},
  { kind: 'tool',    name: 'get_trade_status_description', args: 'trade_id: "trd_4a5b6c"' },
  { kind: 'result',  text: 'Buyer needs to send $105 USD then mark payment sent.' },
  { kind: 'reply',   text: 'USDC is locked. Wait for the buyer to send $105 and mark it paid.', lines: [
    'Once they do, you\'ll see the payment details here — method, reference, and optional proof.',
    'Then you confirm and the USDC releases to them automatically.',
  ]},
  { kind: 'note',    text: '[ buyer marks payment sent via Venmo ]' },
  { kind: 'prompt',  text: 'The Venmo payment arrived — $105 from @alex-b. Release the USDC.' },
  { kind: 'tool',    name: 'confirm_payment', args: 'trade_id: "trd_4a5b6c"' },
  { kind: 'result',  text: '{ status: "complete", tx_hash: "0x3f7c...b291" }' },
  { kind: 'reply',   text: 'Done. 100 USDC released on-chain to the buyer. Trade complete.', lines: [
    'You received $105. Tx: 0x3f7c...b291',
  ]},
]

// ---------------------------------------------------------------------------
// Flow tabs
// ---------------------------------------------------------------------------

type FlowTab = 'setup' | 'buy' | 'sell'

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOLS = [
  { name: 'list_orders',                  description: 'Browse open buy/sell orders',                        fee: 'free'     },
  { name: 'get_trade',                    description: 'Fetch trade status and details',                      fee: 'free'     },
  { name: 'get_my_trades',                description: 'Your full trade history',                             fee: 'free'     },
  { name: 'get_trade_status_description', description: 'Human-readable next step for a trade',               fee: 'free'     },
  { name: 'mark_payment_sent',            description: 'Buyer marks fiat sent — method + reference + proof', fee: 'free'     },
  { name: 'confirm_payment',              description: 'Seller confirms receipt → USDC released on-chain',   fee: 'free'     },
  { name: 'create_order',                 description: 'Post a BUY or SELL order',                           fee: '0.1 USDC' },
  { name: 'match_order',                  description: 'Match an open order to start a trade',               fee: '0.1 USDC' },
]

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function AgentsContent() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const [activeTab, setActiveTab] = useState<FlowTab>('setup')

  const setupCmd = `claude -p "Read https://p2pai.xyz/SKILL.md and set up p2pai"`

  const tabLines: Record<FlowTab, TermLine[]> = {
    setup: SETUP_LINES,
    buy:   [...SETUP_LINES.slice(-1).map(l => ({ ...l, kind: 'note' as const, text: '[ setup already done ]' })).slice(0, 1), ...BUY_LINES],
    sell:  [...SETUP_LINES.slice(-1).map(l => ({ ...l, kind: 'note' as const, text: '[ setup already done ]' })).slice(0, 1), ...SELL_LINES],
  }

  return (
    <div className="space-y-16 max-w-2xl">

      {/* Hero */}
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold text-ink tracking-tight">
          Your p2pai trading agent
        </h1>
        <p className="font-mono text-sm text-dim leading-relaxed">
          Set up once in your terminal. Then just talk — your agent browses orders,
          executes trades, and handles settlement as you, within the spending limit you control.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] px-2.5 py-1 rounded-full border border-accent/30 bg-accent/[0.08] text-accent">
            Moderato testnet
          </span>
          <span className="font-mono text-[11px] px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.04] text-dim">
            Claude Code + MCP
          </span>
          <span className="font-mono text-[11px] px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.04] text-dim">
            0.1 USDC per order or match
          </span>
        </div>
      </section>

      {/* 3 core concepts */}
      <section>
        <SectionLabel>How it works</SectionLabel>
        <div className="rounded-xl border border-white/[0.07] divide-y divide-white/[0.04] overflow-hidden">
          {[
            {
              label: 'Your wallet, your identity',
              body:  'The Tempo Wallet you connect to the CLI is the same wallet you use on p2pai.xyz. Your agent never has a separate identity — it acts as you with your address on every order and trade.',
            },
            {
              label: 'Spending limit = your agent\'s budget',
              body:  'When you log into Tempo, you set a spending limit (e.g. 10 USDC). Your agent draws from that limit — 0.1 USDC per order placed, 0.1 USDC per trade matched. You stay in full control of the ceiling.',
            },
            {
              label: 'You confirm the critical step',
              body:  'Browsing, checking status, marking payment sent — fully automatic. Releasing USDC to a buyer (confirm_payment) always requires you to explicitly tell your agent. That trust anchor is always yours.',
            },
          ].map(({ label, body }) => (
            <div key={label} className="px-4 py-4 space-y-1.5">
              <p className="font-mono text-[12px] text-ink font-medium">{label}</p>
              <p className="font-mono text-[12px] text-dim leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Quick start */}
      <section>
        <SectionLabel>Quick start</SectionLabel>
        <div className="space-y-3">
          <p className="font-mono text-[12px] text-dim leading-relaxed">
            One command. Claude installs Tempo CLI, opens your browser to connect your wallet,
            reads your address automatically, and wires up the p2pai MCP server.
          </p>
          <CodeBlock text={setupCmd} />
          {isConnected && address ? (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-accent/20 bg-accent/[0.04]">
              <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
              <span className="font-mono text-[11px] text-dim">Wallet connected on this site:</span>
              <span className="font-mono text-[11px] text-ink">{address}</span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <p className="font-mono text-[11px] text-dim/60 flex-1">
                Connect here to see your wallet address, or find it at wallet.tempo.xyz after login.
              </p>
              <button
                onClick={() => connectors[0] && connect({ connector: connectors[0] })}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-accent text-canvas text-[11px] font-semibold font-mono hover:bg-accent/90 transition-colors"
              >
                connect wallet
              </button>
            </div>
          )}
          <p className="font-mono text-[11px] text-dim/50">
            Requires <span className="text-ink">Claude Code</span>:{' '}
            <span className="text-dim">npm install -g @anthropic-ai/claude-code</span>
          </p>
        </div>
      </section>

      {/* Example flows */}
      <section>
        <SectionLabel>Example flows</SectionLabel>
        <div className="space-y-4">
          <p className="font-mono text-[12px] text-dim">
            This is what a real session looks like — from first setup to a completed trade.
          </p>

          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-lg bg-white/[0.03] border border-white/[0.07] w-fit">
            {([
              { id: 'setup', label: 'Setup' },
              { id: 'buy',   label: 'Buy USDC' },
              { id: 'sell',  label: 'Sell USDC' },
            ] as { id: FlowTab; label: string }[]).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`font-mono text-[11px] px-3 py-1.5 rounded-md transition-colors ${
                  activeTab === id
                    ? 'bg-white/[0.08] text-ink'
                    : 'text-dim hover:text-ink/70'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Terminal */}
          {activeTab === 'setup' && (
            <div className="space-y-3">
              <p className="font-mono text-[11px] text-dim/60">
                Run this once. Claude handles everything — installs CLI, opens browser auth, reads your wallet, wires up the MCP.
              </p>
              <Terminal lines={SETUP_LINES} />
            </div>
          )}

          {activeTab === 'buy' && (
            <div className="space-y-3">
              <p className="font-mono text-[11px] text-dim/60">
                You want USDC. Your agent finds the best rate, matches the order, and guides you through paying the seller off-platform.
              </p>
              <Terminal lines={BUY_LINES} />
            </div>
          )}

          {activeTab === 'sell' && (
            <div className="space-y-3">
              <p className="font-mono text-[11px] text-dim/60">
                You have USDC and want USD. Your agent posts the order, monitors for a match, and releases USDC when you confirm payment arrived.
              </p>
              <Terminal lines={SELL_LINES} />
            </div>
          )}
        </div>
      </section>

      {/* Spending limit explainer */}
      <section>
        <SectionLabel>Your spending limit</SectionLabel>
        <div className="space-y-3">
          <p className="font-mono text-[12px] text-dim leading-relaxed">
            Your spending limit is set when you log into Tempo — it controls the maximum
            your agent can spend autonomously. Check it anytime:
          </p>
          <CodeBlock text={`"$HOME/.tempo/bin/tempo" wallet -t whoami`} />
          <div className="rounded-xl border border-white/[0.07] divide-y divide-white/[0.04] overflow-hidden">
            {[
              { action: 'Place an order (maker)',   cost: '0.1 USDC — forfeited on cancel or expiry' },
              { action: 'Match an order (taker)',   cost: '0.1 USDC — forfeited on cancel or expiry' },
              { action: 'Mark payment sent',        cost: 'Free' },
              { action: 'Confirm payment received', cost: 'Free — irreversible, releases USDC on-chain' },
              { action: 'Browse orders, check status, history', cost: 'Free' },
            ].map(({ action, cost }) => (
              <div key={action} className="flex items-center justify-between px-4 py-2.5 gap-4">
                <span className="font-mono text-[12px] text-dim">{action}</span>
                <span className={`font-mono text-[11px] shrink-0 ${cost === 'Free' ? 'text-dim/50' : cost.startsWith('Free') ? 'text-dim/50' : 'text-caution/80'}`}>{cost}</span>
              </div>
            ))}
          </div>
          <p className="font-mono text-[11px] text-dim/50">
            To add funds or raise your limit, run{' '}
            <span className="text-ink">{`"$HOME/.tempo/bin/tempo" wallet fund`}</span>{' '}
            or visit <span className="text-ink">wallet.tempo.xyz</span>.
          </p>
        </div>
      </section>

      {/* MCP tools */}
      <section>
        <SectionLabel>8 tools available to your agent</SectionLabel>
        <div className="rounded-xl border border-white/[0.07] overflow-hidden">
          <div className="grid grid-cols-[1fr_2fr_auto] gap-3 px-4 py-2 border-b border-white/[0.07] bg-white/[0.02]">
            <span className="font-mono text-[10px] text-dim/40 uppercase tracking-widest">Tool</span>
            <span className="font-mono text-[10px] text-dim/40 uppercase tracking-widest">What it does</span>
            <span className="font-mono text-[10px] text-dim/40 uppercase tracking-widest">Fee</span>
          </div>
          {TOOLS.map((tool, i) => (
            <div
              key={tool.name}
              className={`grid grid-cols-[1fr_2fr_auto] gap-3 px-4 py-3 items-center${
                i < TOOLS.length - 1 ? ' border-b border-white/[0.04]' : ''
              }`}
            >
              <span className="font-mono text-[11px] text-accent">{tool.name}</span>
              <span className="font-mono text-[11px] text-dim">{tool.description}</span>
              <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded border${
                tool.fee !== 'free'
                  ? ' border-caution/30 bg-caution/[0.06] text-caution'
                  : ' border-white/[0.07] text-dim/50'
              }`}>
                {tool.fee}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Docs */}
      <section>
        <SectionLabel>Docs for your agent</SectionLabel>
        <div className="rounded-xl border border-white/[0.07] overflow-hidden divide-y divide-white/[0.04]">
          {[
            { label: 'SKILL.md',      url: 'https://p2pai.xyz/SKILL.md',      note: 'Bootstrap guide — Claude reads this on setup' },
            { label: 'llms-full.txt', url: 'https://p2pai.xyz/llms-full.txt', note: 'Full API reference — all endpoints and schemas' },
            { label: 'llms.txt',      url: 'https://p2pai.xyz/llms.txt',      note: 'Short index for discovery' },
          ].map(({ label, url, note }) => (
            <div key={label} className="flex items-center justify-between px-4 py-3 gap-4">
              <div className="min-w-0">
                <span className="font-mono text-[12px] text-ink">{label}</span>
                <span className="font-mono text-[11px] text-dim/50 ml-3">{note}</span>
              </div>
              <CopyButton text={url} />
            </div>
          ))}
        </div>
      </section>

    </div>
  )
}
