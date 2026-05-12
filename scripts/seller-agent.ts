#!/usr/bin/env tsx
/**
 * p2pai — Seller Agent v1.0.0
 *
 * Monitors trades for a seller wallet address. When a trade reaches `created`
 * (buyer has matched and paid the taker fee), automatically deposits USDC to
 * the virtual deposit address so the trade can proceed.
 *
 * Trade state machine:
 *   created → deposited → payment_sent → payment_confirmed → released → complete
 *
 * This agent handles: created → deposited (USDC deposit step)
 *
 * Usage:
 *   SELLER_ADDRESS=0x... SELLER_PRIVATE_KEY=0x... FRONTEND_URL=https://... \
 *     tsx scripts/seller-agent.ts
 *
 * Environment:
 *   SELLER_ADDRESS             — the seller's wallet address to monitor
 *   SELLER_PRIVATE_KEY         — hex private key of the seller's EOA (signs USDC transfers)
 *   FRONTEND_URL               — base URL of the Next.js frontend (default: http://localhost:3000)
 *   SUPABASE_URL               — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role key (bypasses RLS for polling)
 *   TEMPO_RPC_URL              — Tempo chain RPC (default: https://rpc.moderato.tempo.xyz)
 *   TEMPO_PATHUSDC_ADDRESS     — TIP-20 USDC contract address
 *   TEMPO_CHAIN_ID             — chain ID (default: 42431)
 *   POLL_INTERVAL_MS           — polling interval in ms (default: 10000)
 */

import { createClient } from '@supabase/supabase-js'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  parseAbiItem,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

const hex40 = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be 0x-prefixed 20-byte address')
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be 0x-prefixed 32-byte hex')

const EnvSchema = z.object({
  SELLER_ADDRESS:            hex40,
  SELLER_PRIVATE_KEY:        hex32,
  FRONTEND_URL:              z.string().url().default('http://localhost:3000'),
  SUPABASE_URL:              z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  TEMPO_RPC_URL:             z.string().url().default('https://rpc.moderato.tempo.xyz'),
  TEMPO_PATHUSDC_ADDRESS:    hex40,
  TEMPO_CHAIN_ID:            z.coerce.number().default(42431),
  POLL_INTERVAL_MS:          z.coerce.number().positive().default(10_000),
})

const envResult = EnvSchema.safeParse(process.env)
if (!envResult.success) {
  console.error('[seller-agent] Invalid environment configuration:')
  for (const issue of envResult.error.issues) {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

const ENV = envResult.data

// Safety gate — this script uses ephemeral in-memory state and is only safe on testnet.
// Remove this check (with explicit intent) when adapting for mainnet operation.
const MODERATO_CHAIN_ID = 42431
if (ENV.TEMPO_CHAIN_ID !== MODERATO_CHAIN_ID) {
  console.error(`[seller-agent] ABORT: this script is testnet-only (expected chain ${MODERATO_CHAIN_ID}, got ${ENV.TEMPO_CHAIN_ID})`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Viem chain + clients
// ---------------------------------------------------------------------------

const tempoChain = defineChain({
  id: ENV.TEMPO_CHAIN_ID,
  name: 'Tempo Moderato',
  nativeCurrency: { name: 'PathUSD', symbol: 'pathUSD', decimals: 6 },
  rpcUrls: { default: { http: [ENV.TEMPO_RPC_URL] } },
})

const publicClient = createPublicClient({
  chain: tempoChain,
  transport: http(ENV.TEMPO_RPC_URL),
})

const sellerAccount = privateKeyToAccount(ENV.SELLER_PRIVATE_KEY as `0x${string}`)

const walletClient = createWalletClient({
  account: sellerAccount,
  chain: tempoChain,
  transport: http(ENV.TEMPO_RPC_URL),
})

const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
])

const tokenAddress = ENV.TEMPO_PATHUSDC_ADDRESS as `0x${string}`

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

const db = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TradeRow {
  id: string
  usdc_amount: number
  usd_amount: number
  virtual_deposit_address: string
  status: string
}

// ---------------------------------------------------------------------------
// State — tracks trades already processed this session
// ---------------------------------------------------------------------------

const processed = new Set<string>()

// ---------------------------------------------------------------------------
// Balance check
// ---------------------------------------------------------------------------

async function getSellerUsdcBalance(): Promise<bigint> {
  return publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [ENV.SELLER_ADDRESS as `0x${string}`],
  })
}

// ---------------------------------------------------------------------------
// Deposit USDC to virtual address
// ---------------------------------------------------------------------------

const TIP20_TRANSFER_ABI = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
)

async function isAlreadyDeposited(depositAddress: `0x${string}`, amountRaw: bigint): Promise<boolean> {
  try {
    const logs = await publicClient.getLogs({
      address: tokenAddress,
      event: TIP20_TRANSFER_ABI,
      args: { to: depositAddress },
      fromBlock: 0n,
      toBlock: 'latest',
    })
    return logs.some(log => (log.args.value ?? 0n) >= amountRaw)
  } catch {
    return false
  }
}

async function depositUsdc(trade: TradeRow): Promise<void> {
  const amountRaw = BigInt(Math.round(trade.usdc_amount * 1e6))
  const depositAddress = trade.virtual_deposit_address as `0x${string}`

  // Guard against double-deposit on script restart — check on-chain first.
  const alreadySent = await isAlreadyDeposited(depositAddress, amountRaw)
  if (alreadySent) {
    console.log(`[seller-agent] Trade ${trade.id} — deposit already on-chain, skipping`)
    return
  }

  // Verify balance before attempting transfer
  const balance = await getSellerUsdcBalance()
  const balanceUsdc = Number(balance) / 1e6

  if (balance < amountRaw) {
    throw new Error(
      `Insufficient balance: have ${balanceUsdc.toFixed(2)} USDC, need ${trade.usdc_amount} USDC`
    )
  }

  console.log(`[seller-agent] Trade ${trade.id} — depositing ${trade.usdc_amount} USDC`)
  console.log(`[seller-agent]   to:      ${depositAddress}`)
  console.log(`[seller-agent]   balance: ${balanceUsdc.toFixed(2)} USDC`)

  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [depositAddress, amountRaw],
  })

  console.log(`[seller-agent]   tx:      ${hash}`)
  console.log(`[seller-agent]   waiting for confirmation...`)

  // Tempo has sub-second deterministic finality — one block = final
  await publicClient.waitForTransactionReceipt({ hash })

  console.log(`[seller-agent] ✓ Trade ${trade.id} — USDC deposited (tx: ${hash})`)
  console.log(`[seller-agent]   Waiting for agent to detect Transfer event → deposited`)
}

// ---------------------------------------------------------------------------
// Poll for new matched trades (status = created)
// ---------------------------------------------------------------------------

async function poll(): Promise<void> {
  const { data: trades, error } = await db
    .from('trades')
    .select('id, usdc_amount, usd_amount, virtual_deposit_address, status')
    .eq('seller_address', ENV.SELLER_ADDRESS.toLowerCase())
    .eq('status', 'created')

  if (error) {
    console.error('[seller-agent] Supabase query error:', error.message)
    return
  }

  if (!trades || trades.length === 0) return

  for (const trade of trades as TradeRow[]) {
    if (processed.has(trade.id)) continue

    if (!trade.virtual_deposit_address) {
      console.warn(`[seller-agent] Trade ${trade.id} has no virtual_deposit_address — skipping`)
      continue
    }

    // Mark as processed before the async call to prevent duplicate attempts
    // on the next poll tick if the transfer is slow.
    processed.add(trade.id)

    try {
      await depositUsdc(trade)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[seller-agent] ✗ Trade ${trade.id} failed: ${msg}`)
      // Remove from processed so we retry on the next poll cycle.
      processed.delete(trade.id)
    }
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

console.log('[seller-agent] ─────────────────────────────────────────────')
console.log(`[seller-agent] p2pai Seller Agent v1.0.0`)
console.log(`[seller-agent] Watching for:   seller_address = ${ENV.SELLER_ADDRESS}`)
console.log(`[seller-agent]                  status         = created`)
console.log(`[seller-agent] Signer address: ${sellerAccount.address}`)
console.log(`[seller-agent] Frontend URL:   ${ENV.FRONTEND_URL}`)
console.log(`[seller-agent] RPC:            ${ENV.TEMPO_RPC_URL}`)
console.log(`[seller-agent] Poll interval:  ${ENV.POLL_INTERVAL_MS}ms`)
console.log('[seller-agent] ─────────────────────────────────────────────')
console.log()

void poll()
setInterval(() => { void poll() }, ENV.POLL_INTERVAL_MS)
