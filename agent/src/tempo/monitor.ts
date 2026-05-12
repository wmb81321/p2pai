/**
 * Watches Tempo TIP-20 Transfer events for virtual deposit addresses.
 * When a deposit arrives, transitions trade to 'deposited'.
 *
 * Key rule: never call balanceOf(virtualAddress) — it always returns zero.
 * Instead, watch Transfer events where `to === virtualAddress`.
 */

import { parseAbiItem } from 'viem'
import { publicClient } from './chain.js'
import { db, updateTradeStatus } from '../lib/supabase.js'

const TIP20_TRANSFER_ABI = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
)

export async function watchDeposit(
  virtualAddress: `0x${string}`,
  tradeId: string,
  tokenAddress: `0x${string}`,
  expectedAmount: bigint,
  deadlineMs: number,
): Promise<'deposited' | 'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unwatch()
      resolve('timeout')
    }, deadlineMs - Date.now())

    const unwatch = publicClient.watchEvent({
      address: tokenAddress,
      event: TIP20_TRANSFER_ABI,
      args: { to: virtualAddress },
      onLogs: async (logs) => {
        for (const log of logs) {
          if ((log.args.value ?? 0n) >= expectedAmount) {
            clearTimeout(timer)
            unwatch()
            await updateTradeStatus(tradeId, 'deposited')
            resolve('deposited')
            return
          } else {
            // Under-amount deposit: funds forwarded to master wallet but trade not unlocked.
            // Log for manual review — operator must refund or ask seller to top up.
            console.warn(
              `[monitor] UNDER-AMOUNT deposit for trade ${tradeId}: ` +
              `received ${log.args.value ?? 0n} units, expected ${expectedAmount}. ` +
              `VA: ${virtualAddress} tx: ${log.transactionHash ?? 'unknown'}`,
            )
          }
        }
      },
    })
  })
}

/**
 * Check whether a deposit already landed while the agent was offline.
 * `watchEvent` only catches live events — this fills the gap on restart.
 */
async function checkHistoricalDeposit(
  virtualAddress: `0x${string}`,
  tokenAddress: `0x${string}`,
  expectedAmount: bigint,
): Promise<boolean> {
  try {
    const logs = await publicClient.getLogs({
      address: tokenAddress,
      event: TIP20_TRANSFER_ABI,
      args: { to: virtualAddress },
      fromBlock: 0n,
      toBlock: 'latest',
    })
    return logs.some(log => (log.args.value ?? 0n) >= expectedAmount)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[monitor] Historical log query failed for ${virtualAddress}: ${msg}`)
    return false
  }
}

export async function startDepositMonitor(tokenAddress: `0x${string}`) {
  const { data: trades } = await db
    .from('trades')
    .select('id, virtual_deposit_address, usdc_amount, deposit_deadline')
    .eq('status', 'created')

  if (!trades?.length) return

  console.log(`[monitor] Resuming watch for ${trades.length} pending deposit(s)`)

  // Run all watchers in parallel — each resolves independently on deposit or timeout
  await Promise.all(trades.map(async (trade) => {
    const deadlineMs = new Date(trade.deposit_deadline).getTime()
    const expectedAmount = BigInt(Math.round(trade.usdc_amount * 1e6))
    const virtualAddress = trade.virtual_deposit_address as `0x${string}`

    // Already expired — mark immediately instead of starting a watcher
    if (Date.now() >= deadlineMs) {
      await updateTradeStatus(trade.id, 'deposit_timeout')
      console.log(`[monitor] Trade ${trade.id} → deposit_timeout (already expired)`)
      return
    }

    // Backfill: deposit may have landed while the agent was restarting.
    // watchEvent is forward-only — getLogs covers the offline gap.
    const alreadyDeposited = await checkHistoricalDeposit(virtualAddress, tokenAddress, expectedAmount)
    if (alreadyDeposited) {
      await updateTradeStatus(trade.id, 'deposited')
      console.log(`[monitor] Trade ${trade.id} → deposited (backfill on restart)`)
      return
    }

    const result = await watchDeposit(
      virtualAddress,
      trade.id,
      tokenAddress,
      expectedAmount,
      deadlineMs,
    )

    if (result === 'timeout') {
      await updateTradeStatus(trade.id, 'deposit_timeout')
      console.log(`[monitor] Trade ${trade.id} → deposit_timeout`)
    }
  }))
}
