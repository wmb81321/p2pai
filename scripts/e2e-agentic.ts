#!/usr/bin/env tsx
/**
 * p2pai — End-to-End Agentic Test (Phase 12)
 *
 * Runs a complete trade headlessly on Moderato testnet.
 * Both seller and buyer are autonomous agents using private key EOAs.
 *
 * Trade flow:
 *   1. Seller creates SELL order (pays 0.1 USDC maker fee via mppx)
 *   2. Buyer matches order (pays 0.1 USDC taker fee via mppx)
 *   3. Seller deposits USDC to virtual deposit address
 *   4. Agent detects Transfer event → status: deposited
 *   5. Buyer marks payment sent
 *   6. Seller confirms payment received → USDC released on-chain
 *   7. Assert status = complete and buyer USDC balance increased
 *
 * Usage:
 *   SELLER_ADDRESS=0x... SELLER_PRIVATE_KEY=0x... \
 *   BUYER_ADDRESS=0x... BUYER_PRIVATE_KEY=0x... \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   TEMPO_PATHUSDC_ADDRESS=0x... \
 *     tsx scripts/e2e-agentic.ts
 *
 * Run from the agent/ directory (to resolve mppx + viem from agent/node_modules):
 *   cd agent && tsx ../scripts/e2e-agentic.ts
 */

import { createClient } from '@supabase/supabase-js'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} from 'viem'
import { tempoModerato } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { Mppx, tempo } from 'mppx/client'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

const hex40 = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be 0x-prefixed 20-byte address')
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be 0x-prefixed 32-byte hex')

const EnvSchema = z.object({
  SELLER_ADDRESS:            hex40,
  SELLER_PRIVATE_KEY:        hex32,
  BUYER_ADDRESS:             hex40,
  BUYER_PRIVATE_KEY:         hex32,
  FRONTEND_URL:              z.string().url().default('http://localhost:3000'),
  SUPABASE_URL:              z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TEMPO_RPC_URL:             z.string().url().default('https://rpc.moderato.tempo.xyz'),
  TEMPO_PATHUSDC_ADDRESS:    hex40,
  TEST_USDC_AMOUNT:          z.coerce.number().min(5).default(5),
  TEST_RATE:                 z.coerce.number().positive().default(1.01),
  POLL_TIMEOUT_MS:           z.coerce.number().positive().default(120_000),
  POLL_INTERVAL_MS:          z.coerce.number().positive().default(3_000),
})

const envResult = EnvSchema.safeParse(process.env)
if (!envResult.success) {
  console.error('[e2e] Invalid environment configuration:')
  for (const issue of envResult.error.issues) {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

const ENV = envResult.data

// Safety gate — this script generates ephemeral wallets and is only safe on testnet.
// It cannot recover funded keys if it crashes mid-run. Do not run against mainnet.
const MODERATO_CHAIN_ID = 42431
const chainId = Number(process.env.TEMPO_CHAIN_ID ?? MODERATO_CHAIN_ID)
if (chainId !== MODERATO_CHAIN_ID) {
  console.error(`[e2e] ABORT: testnet-only script (expected chain ${MODERATO_CHAIN_ID}, got ${chainId})`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Viem chain + clients
// ---------------------------------------------------------------------------

const chain = {
  ...tempoModerato,
  rpcUrls: { default: { http: [ENV.TEMPO_RPC_URL] } },
}

const publicClient = createPublicClient({
  chain,
  transport: http(ENV.TEMPO_RPC_URL),
})

const sellerAccount = privateKeyToAccount(ENV.SELLER_PRIVATE_KEY as `0x${string}`)
const buyerAccount  = privateKeyToAccount(ENV.BUYER_PRIVATE_KEY  as `0x${string}`)

const sellerWalletClient = createWalletClient({ account: sellerAccount, chain, transport: http(ENV.TEMPO_RPC_URL) })
const buyerWalletClient  = createWalletClient({ account: buyerAccount,  chain, transport: http(ENV.TEMPO_RPC_URL) })

const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
])

const tokenAddress = ENV.TEMPO_PATHUSDC_ADDRESS as `0x${string}`

// ---------------------------------------------------------------------------
// mppx clients (handles 402 fee payment automatically)
// ---------------------------------------------------------------------------

const sellerMppx = Mppx.create({
  methods: [tempo.charge({ account: sellerAccount, getClient: () => sellerWalletClient })],
  polyfill: false,
})

const buyerMppx = Mppx.create({
  methods: [tempo.charge({ account: buyerAccount, getClient: () => buyerWalletClient })],
  polyfill: false,
})

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

const db = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getUsdcBalance(address: `0x${string}`): Promise<number> {
  const raw = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  })
  return Number(raw) / 1e6
}

async function pollTradeStatus(
  tradeId: string,
  targetStatus: string,
  label: string,
): Promise<void> {
  const deadline = Date.now() + ENV.POLL_TIMEOUT_MS
  process.stdout.write(`[e2e] Waiting for ${label} (trade: ${tradeId})`)

  while (Date.now() < deadline) {
    const { data, error } = await db
      .from('trades')
      .select('status')
      .eq('id', tradeId)
      .single()

    if (error) throw new Error(`Supabase poll error: ${error.message}`)

    if (data?.status === targetStatus) {
      process.stdout.write(' ✓\n')
      return
    }

    // Bail early on terminal failure states
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

function logStep(n: number, label: string) {
  console.log()
  console.log(`[e2e] ── Step ${n}: ${label}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  console.log('[e2e] ─────────────────────────────────────────────────────')
  console.log(`[e2e] p2pai End-to-End Agentic Test`)
  console.log(`[e2e] Seller:       ${ENV.SELLER_ADDRESS}`)
  console.log(`[e2e] Buyer:        ${ENV.BUYER_ADDRESS}`)
  console.log(`[e2e] Order size:   ${ENV.TEST_USDC_AMOUNT} USDC @ ${ENV.TEST_RATE} USD/USDC`)
  console.log(`[e2e] Frontend:     ${ENV.FRONTEND_URL}`)
  console.log('[e2e] ─────────────────────────────────────────────────────')

  // ── Pre-check balances ────────────────────────────────────────────────────

  const sellerBalance = await getUsdcBalance(ENV.SELLER_ADDRESS as `0x${string}`)
  const buyerBalance  = await getUsdcBalance(ENV.BUYER_ADDRESS  as `0x${string}`)
  const sellerNeeds   = ENV.TEST_USDC_AMOUNT + 0.1  // deposit + maker fee
  const buyerNeeds    = 0.1                          // taker fee only (buyer pays fiat off-platform)

  console.log(`[e2e] Seller USDC: ${sellerBalance.toFixed(2)} (needs ${sellerNeeds.toFixed(2)})`)
  console.log(`[e2e] Buyer USDC:  ${buyerBalance.toFixed(2)} (needs ${buyerNeeds.toFixed(2)})`)

  if (sellerBalance < sellerNeeds) {
    throw new Error(
      `Seller has insufficient USDC: ${sellerBalance.toFixed(2)} < ${sellerNeeds.toFixed(2)}`
    )
  }
  if (buyerBalance < buyerNeeds) {
    throw new Error(
      `Buyer has insufficient USDC: ${buyerBalance.toFixed(2)} < ${buyerNeeds.toFixed(2)}`
    )
  }

  // ── Step 1: Create SELL order ─────────────────────────────────────────────

  logStep(1, 'Seller creates SELL order (mppx maker fee 0.1 USDC)')

  const orderBody = JSON.stringify({
    user_address:  ENV.SELLER_ADDRESS,
    type:          'sell',
    usdc_amount:   ENV.TEST_USDC_AMOUNT,
    rate:          ENV.TEST_RATE,
    payment_methods: [
      { type: 'other', label: 'E2E Test', value: 'e2e-synthetic' },
    ],
  })

  const orderRes = await sellerMppx.fetch(`${ENV.FRONTEND_URL}/api/orders`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    orderBody,
  })

  if (!orderRes.ok) {
    const err = await orderRes.text()
    throw new Error(`POST /api/orders failed ${orderRes.status}: ${err}`)
  }

  const order = await orderRes.json() as {
    id: string
    virtual_deposit_address: string
    usdc_amount: number
    usd_amount: number
  }

  console.log(`[e2e] ✓ Order created: ${order.id}`)
  console.log(`[e2e]   virtual_deposit_address: ${order.virtual_deposit_address}`)

  // ── Step 2: Buyer matches order ───────────────────────────────────────────

  logStep(2, 'Buyer matches SELL order (mppx taker fee 0.1 USDC)')

  const tradeBody = JSON.stringify({
    order_id:       order.id,
    buyer_address:  ENV.BUYER_ADDRESS,
    seller_address: ENV.SELLER_ADDRESS,
    usdc_amount:    order.usdc_amount,
    usd_amount:     order.usd_amount,
  })

  const tradeRes = await buyerMppx.fetch(`${ENV.FRONTEND_URL}/api/trades`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    tradeBody,
  })

  if (!tradeRes.ok) {
    const err = await tradeRes.text()
    throw new Error(`POST /api/trades failed ${tradeRes.status}: ${err}`)
  }

  const trade = await tradeRes.json() as {
    trade_id: string
    virtual_deposit_address: string
    deposit_deadline: string
  }

  const tradeId         = trade.trade_id
  const depositAddress  = trade.virtual_deposit_address as `0x${string}`

  console.log(`[e2e] ✓ Trade created: ${tradeId}`)
  console.log(`[e2e]   deposit_deadline: ${trade.deposit_deadline}`)

  // ── Step 3: Seller deposits USDC ─────────────────────────────────────────

  logStep(3, `Seller deposits ${order.usdc_amount} USDC to virtual address`)

  const depositAmount = BigInt(Math.round(order.usdc_amount * 1e6))

  const txHash = await sellerWalletClient.writeContract({
    address:      tokenAddress,
    abi:          ERC20_ABI,
    functionName: 'transfer',
    args:         [depositAddress, depositAmount],
  })

  console.log(`[e2e]   tx: ${txHash}`)
  await publicClient.waitForTransactionReceipt({ hash: txHash })
  console.log(`[e2e] ✓ USDC deposited`)

  // ── Step 4: Wait for deposited ────────────────────────────────────────────

  logStep(4, 'Waiting for agent to detect Transfer event → deposited')
  await pollTradeStatus(tradeId, 'deposited', 'status = deposited')

  // ── Step 5: Buyer marks payment sent ─────────────────────────────────────

  logStep(5, 'Buyer marks payment sent')

  const paymentRef = `e2e-${tradeId.replace(/-/g, '').slice(0, 8)}-${Date.now()}`

  const sentRes = await fetch(`${ENV.FRONTEND_URL}/api/trades/${tradeId}/payment-sent`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      buyer_address:     ENV.BUYER_ADDRESS,
      payment_method:    'other',
      payment_reference: paymentRef,
    }),
  })

  if (!sentRes.ok) {
    const err = await sentRes.text()
    throw new Error(`POST /payment-sent failed ${sentRes.status}: ${err}`)
  }

  console.log(`[e2e] ✓ Payment marked sent (ref: ${paymentRef})`)

  // ── Step 6: Seller confirms payment ──────────────────────────────────────

  logStep(6, 'Seller confirms payment received → USDC released on-chain')

  const confirmRes = await fetch(`${ENV.FRONTEND_URL}/api/trades/${tradeId}/confirm-payment`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ seller_address: ENV.SELLER_ADDRESS }),
  })

  if (!confirmRes.ok) {
    const err = await confirmRes.text()
    throw new Error(`POST /confirm-payment failed ${confirmRes.status}: ${err}`)
  }

  const confirmData = await confirmRes.json() as { status: string; tx_hash?: string }
  console.log(`[e2e] ✓ Payment confirmed (status: ${confirmData.status})`)
  if (confirmData.tx_hash) console.log(`[e2e]   release tx: ${confirmData.tx_hash}`)

  // ── Step 7: Wait for complete ─────────────────────────────────────────────

  logStep(7, 'Waiting for trade to reach complete')
  await pollTradeStatus(tradeId, 'complete', 'status = complete')

  // ── Step 8: Assert buyer USDC balance increased ───────────────────────────

  logStep(8, 'Asserting buyer USDC balance increased')

  const buyerFinalBalance = await getUsdcBalance(ENV.BUYER_ADDRESS as `0x${string}`)
  const gained = buyerFinalBalance - buyerBalance

  console.log(`[e2e]   Buyer before: ${buyerBalance.toFixed(2)} USDC`)
  console.log(`[e2e]   Buyer after:  ${buyerFinalBalance.toFixed(2)} USDC`)
  console.log(`[e2e]   Net gain:     +${gained.toFixed(2)} USDC (expected: +${order.usdc_amount})`)

  const tolerance = 0.001
  if (gained < order.usdc_amount - tolerance) {
    throw new Error(
      `Buyer balance did not increase by expected amount: gained ${gained.toFixed(4)} USDC, expected ${order.usdc_amount}`
    )
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log()
  console.log('[e2e] ─────────────────────────────────────────────────────')
  console.log('[e2e]  ALL STEPS PASSED')
  console.log(`[e2e]  Trade ID:  ${tradeId}`)
  console.log(`[e2e]  Order ID:  ${order.id}`)
  console.log(`[e2e]  USDC:      ${order.usdc_amount} transferred seller → buyer`)
  console.log('[e2e] ─────────────────────────────────────────────────────')
}

run().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error()
  console.error('[e2e] FAILED:', msg)
  process.exit(1)
})
