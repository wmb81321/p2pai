#!/usr/bin/env tsx
/**
 * p2pai — E2E Setup + Runner
 *
 * Generates two fresh ephemeral EOA wallets, funds them from the agent
 * wallet (AGENT_ACCESS_KEY), then runs the full end-to-end trade test.
 *
 * One command. No manual wallet setup required.
 *
 * Usage (from agent/ directory):
 *   tsx ../scripts/setup-e2e.ts
 *
 * Required env (already in your .env):
 *   AGENT_ACCESS_KEY            — agent EOA private key (funds test wallets)
 *   AGENT_ACCESS_KEY_ADDRESS    — agent EOA address (balance check)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TEMPO_RPC_URL
 *   TEMPO_PATHUSDC_ADDRESS
 *
 * Optional:
 *   TEST_USDC_AMOUNT            — USDC amount to trade (default: 5, min 5)
 *   TEST_RATE                   — USD per USDC (default: 1.01)
 *   FRONTEND_URL                — frontend URL (default: https://p2pai.xyz)
 *   POLL_TIMEOUT_MS             — max wait per status transition (default: 120000)
 *   POLL_INTERVAL_MS            — poll cadence (default: 3000)
 */

import { createClient }              from '@supabase/supabase-js'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
}                                     from 'viem'
import { tempoModerato }             from 'viem/chains'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { Mppx, tempo }               from 'mppx/client'
import { z }                         from 'zod'

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

const hex40 = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/)

const EnvSchema = z.object({
  // Agent wallet — source of funds for test wallets
  AGENT_ACCESS_KEY:          hex32,
  AGENT_ACCESS_KEY_ADDRESS:  hex40,

  // Infrastructure
  SUPABASE_URL:              z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TEMPO_RPC_URL:             z.string().url().default('https://rpc.moderato.tempo.xyz'),
  TEMPO_PATHUSDC_ADDRESS:    hex40,

  // Test parameters
  FRONTEND_URL:              z.string().url().default('https://p2pai.xyz'),
  TEST_USDC_AMOUNT:          z.coerce.number().min(5).default(5),
  TEST_RATE:                 z.coerce.number().positive().default(1.01),
  POLL_TIMEOUT_MS:           z.coerce.number().positive().default(120_000),
  POLL_INTERVAL_MS:          z.coerce.number().positive().default(3_000),
})

const envResult = EnvSchema.safeParse(process.env)
if (!envResult.success) {
  console.error('[setup-e2e] Missing environment variables:')
  for (const issue of envResult.error.issues) {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

const ENV = envResult.data

// ---------------------------------------------------------------------------
// Chain + clients
// ---------------------------------------------------------------------------

const chain = {
  ...tempoModerato,
  rpcUrls: { default: { http: [ENV.TEMPO_RPC_URL] } },
}

const publicClient = createPublicClient({ chain, transport: http(ENV.TEMPO_RPC_URL) })

const agentAccount     = privateKeyToAccount(ENV.AGENT_ACCESS_KEY as `0x${string}`)
const agentWalletClient = createWalletClient({ account: agentAccount, chain, transport: http(ENV.TEMPO_RPC_URL) })

const tokenAddress = ENV.TEMPO_PATHUSDC_ADDRESS as `0x${string}`

const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
])

const db = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getBalance(address: `0x${string}`): Promise<number> {
  const raw = await publicClient.readContract({
    address: tokenAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [address],
  })
  return Number(raw) / 1e6
}

async function fundWallet(to: `0x${string}`, amountUsdc: number, label: string): Promise<void> {
  const amount = BigInt(Math.round(amountUsdc * 1e6))
  console.log(`[setup-e2e] Funding ${label} (${to}) with ${amountUsdc} USDC...`)
  const hash = await agentWalletClient.writeContract({
    address: tokenAddress, abi: ERC20_ABI, functionName: 'transfer', args: [to, amount],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  console.log(`[setup-e2e] ✓ Funded ${label} (tx: ${hash})`)
}

async function pollTradeStatus(tradeId: string, targetStatus: string, label: string): Promise<void> {
  const deadline = Date.now() + ENV.POLL_TIMEOUT_MS
  process.stdout.write(`[e2e] Waiting for ${label}`)

  while (Date.now() < deadline) {
    const { data, error } = await db.from('trades').select('status').eq('id', tradeId).single()
    if (error) throw new Error(`Supabase poll error: ${error.message}`)

    if (data?.status === targetStatus) {
      process.stdout.write(' ✓\n')
      return
    }

    if (['deposit_timeout', 'disputed', 'cancelled', 'refunded'].includes(data?.status ?? '')) {
      process.stdout.write('\n')
      throw new Error(`Trade reached failure state: ${data?.status}`)
    }

    process.stdout.write('.')
    await new Promise((r) => setTimeout(r, ENV.POLL_INTERVAL_MS))
  }

  process.stdout.write('\n')
  throw new Error(`Timed out waiting for trade status = ${targetStatus}`)
}

function step(n: number, label: string) {
  console.log()
  console.log(`[e2e] ── Step ${n}: ${label}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  // ── Generate ephemeral test wallets ──────────────────────────────────────

  console.log('[setup-e2e] ──────────────────────────────────────────────')
  console.log('[setup-e2e] p2pai E2E Setup + Runner')
  console.log('[setup-e2e] Generating ephemeral test wallets...')
  console.log()

  const sellerKey     = generatePrivateKey()
  const sellerAccount = privateKeyToAccount(sellerKey)
  const sellerAddress = sellerAccount.address

  const buyerKey     = generatePrivateKey()
  const buyerAccount = privateKeyToAccount(buyerKey)
  const buyerAddress = buyerAccount.address

  console.log(`[setup-e2e] Seller: ${sellerAddress}`)
  console.log(`[setup-e2e] Buyer:  ${buyerAddress}`)

  // ── Check agent balance ───────────────────────────────────────────────────

  const sellerNeeds   = ENV.TEST_USDC_AMOUNT + 0.2   // deposit + maker fee + buffer
  const buyerNeeds    = 0.2                           // taker fee + buffer
  const totalNeeded   = sellerNeeds + buyerNeeds

  const agentBalance = await getBalance(ENV.AGENT_ACCESS_KEY_ADDRESS as `0x${string}`)
  console.log(`[setup-e2e] Agent balance: ${agentBalance.toFixed(2)} USDC (need ${totalNeeded.toFixed(2)})`)

  if (agentBalance < totalNeeded) {
    throw new Error(
      `Agent wallet has insufficient USDC: ${agentBalance.toFixed(2)} < ${totalNeeded.toFixed(2)}.\n` +
      `Run: tempo wallet fund   (or use the /account faucet)`
    )
  }

  // ── Fund test wallets from agent ─────────────────────────────────────────

  await fundWallet(sellerAddress, sellerNeeds, 'seller')
  await fundWallet(buyerAddress,  buyerNeeds,  'buyer')

  // ── Set up mppx clients ───────────────────────────────────────────────────

  const sellerWalletClient = createWalletClient({ account: sellerAccount, chain, transport: http(ENV.TEMPO_RPC_URL) })
  const buyerWalletClient  = createWalletClient({ account: buyerAccount,  chain, transport: http(ENV.TEMPO_RPC_URL) })

  const sellerMppx = Mppx.create({
    methods: [tempo.charge({ account: sellerAccount, getClient: () => sellerWalletClient })],
    polyfill: false,
  })

  const buyerMppx = Mppx.create({
    methods: [tempo.charge({ account: buyerAccount, getClient: () => buyerWalletClient })],
    polyfill: false,
  })

  // ── Log test config ───────────────────────────────────────────────────────

  console.log()
  console.log('[e2e] ──────────────────────────────────────────────────────')
  console.log('[e2e] p2pai End-to-End Agentic Test')
  console.log(`[e2e] Seller:     ${sellerAddress}`)
  console.log(`[e2e] Buyer:      ${buyerAddress}`)
  console.log(`[e2e] Order size: ${ENV.TEST_USDC_AMOUNT} USDC @ ${ENV.TEST_RATE} USD/USDC`)
  console.log(`[e2e] Frontend:   ${ENV.FRONTEND_URL}`)
  console.log('[e2e] ──────────────────────────────────────────────────────')

  // ── Step 1: Create SELL order ─────────────────────────────────────────────

  step(1, 'Seller creates SELL order (mppx maker fee 0.1 USDC)')

  const orderRes = await sellerMppx.fetch(`${ENV.FRONTEND_URL}/api/orders`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_address:    sellerAddress,
      type:            'sell',
      usdc_amount:     ENV.TEST_USDC_AMOUNT,
      rate:            ENV.TEST_RATE,
      payment_methods: [{ type: 'other', label: 'E2E Test', value: 'e2e-synthetic' }],
    }),
  })

  if (!orderRes.ok) {
    const err = await orderRes.text()
    throw new Error(`POST /api/orders ${orderRes.status}: ${err}`)
  }

  const order = await orderRes.json() as {
    id: string; virtual_deposit_address: string; usdc_amount: number; usd_amount: number
  }

  console.log(`[e2e] ✓ Order: ${order.id}`)
  console.log(`[e2e]   deposit address: ${order.virtual_deposit_address}`)

  // ── Step 2: Buyer matches order ───────────────────────────────────────────

  step(2, 'Buyer matches SELL order (mppx taker fee 0.1 USDC)')

  const tradeRes = await buyerMppx.fetch(`${ENV.FRONTEND_URL}/api/trades`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order_id:       order.id,
      buyer_address:  buyerAddress,
      seller_address: sellerAddress,
      usdc_amount:    order.usdc_amount,
      usd_amount:     order.usd_amount,
    }),
  })

  if (!tradeRes.ok) {
    const err = await tradeRes.text()
    throw new Error(`POST /api/trades ${tradeRes.status}: ${err}`)
  }

  const trade = await tradeRes.json() as {
    trade_id: string; virtual_deposit_address: string; deposit_deadline: string
  }

  const tradeId        = trade.trade_id
  const depositAddress = trade.virtual_deposit_address as `0x${string}`

  console.log(`[e2e] ✓ Trade: ${tradeId}`)
  console.log(`[e2e]   deposit deadline: ${trade.deposit_deadline}`)

  // ── Step 3: Seller deposits USDC ──────────────────────────────────────────

  step(3, `Seller deposits ${order.usdc_amount} USDC to virtual address`)

  const depositAmount = BigInt(Math.round(order.usdc_amount * 1e6))
  const depositHash   = await sellerWalletClient.writeContract({
    address: tokenAddress, abi: ERC20_ABI, functionName: 'transfer',
    args: [depositAddress, depositAmount],
  })

  await publicClient.waitForTransactionReceipt({ hash: depositHash })
  console.log(`[e2e] ✓ Deposited (tx: ${depositHash})`)

  // ── Step 4: Wait for deposited ────────────────────────────────────────────

  step(4, 'Waiting for agent Transfer detection → deposited')
  await pollTradeStatus(tradeId, 'deposited', 'status = deposited')

  // ── Step 5: Buyer marks payment sent ──────────────────────────────────────

  step(5, 'Buyer marks payment sent')

  const paymentRef = `e2e-${tradeId.replace(/-/g, '').slice(0, 8)}-${Date.now()}`
  const sentRes    = await fetch(`${ENV.FRONTEND_URL}/api/trades/${tradeId}/payment-sent`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      buyer_address:     buyerAddress,
      payment_method:    'other',
      payment_reference: paymentRef,
    }),
  })

  if (!sentRes.ok) {
    const err = await sentRes.text()
    throw new Error(`POST /payment-sent ${sentRes.status}: ${err}`)
  }

  console.log(`[e2e] ✓ Payment marked sent (ref: ${paymentRef})`)

  // ── Step 6: Seller confirms payment ───────────────────────────────────────

  step(6, 'Seller confirms payment → USDC released on-chain')

  const confirmRes = await fetch(`${ENV.FRONTEND_URL}/api/trades/${tradeId}/confirm-payment`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seller_address: sellerAddress }),
  })

  if (!confirmRes.ok) {
    const err = await confirmRes.text()
    throw new Error(`POST /confirm-payment ${confirmRes.status}: ${err}`)
  }

  const confirmData = await confirmRes.json() as { status: string; tx_hash?: string }
  console.log(`[e2e] ✓ Payment confirmed (status: ${confirmData.status})`)
  if (confirmData.tx_hash) console.log(`[e2e]   release tx: ${confirmData.tx_hash}`)

  // ── Step 7: Wait for complete ─────────────────────────────────────────────

  step(7, 'Waiting for complete')
  await pollTradeStatus(tradeId, 'complete', 'status = complete')

  // ── Step 8: Assert buyer balance increased ────────────────────────────────

  step(8, 'Asserting buyer USDC balance increased')

  const buyerFinal   = await getBalance(buyerAddress)
  // Buyer started with buyerNeeds (0.2) minus taker fee (0.1) = 0.1 remaining, plus usdc_amount received
  const expectedFinal = buyerNeeds - 0.1 + order.usdc_amount
  const tolerance     = 0.01

  console.log(`[e2e]   Buyer balance: ${buyerFinal.toFixed(4)} USDC (expected ~${expectedFinal.toFixed(4)})`)

  if (buyerFinal < expectedFinal - tolerance) {
    throw new Error(
      `Buyer final balance ${buyerFinal.toFixed(4)} is below expected ${expectedFinal.toFixed(4)}`
    )
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log()
  console.log('[e2e] ──────────────────────────────────────────────────────')
  console.log('[e2e]  ALL STEPS PASSED ✓')
  console.log(`[e2e]  Trade:   ${tradeId}`)
  console.log(`[e2e]  Order:   ${order.id}`)
  console.log(`[e2e]  USDC:    ${order.usdc_amount} transferred seller → buyer`)
  console.log('[e2e] ──────────────────────────────────────────────────────')
}

run().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error()
  console.error('[e2e] FAILED:', msg)
  process.exit(1)
})
