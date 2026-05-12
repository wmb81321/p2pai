/**
 * Agent USDC transfer operations.
 *
 * The agent EOA (AGENT_ACCESS_KEY_ADDRESS) holds all escrowed USDC —
 * virtual address deposits auto-forward here. This module releases
 * USDC to buyers after the seller confirms fiat receipt.
 *
 * Tempo has sub-second deterministic finality — one block = final.
 * waitForTransactionReceipt returns immediately after inclusion.
 */

import { parseAbi } from 'viem'
import { publicClient, walletClient } from './chain.js'
import { ENV } from '../lib/env.js'

const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
])

const tokenAddress = ENV.TEMPO_PATHUSDC_ADDRESS as `0x${string}`

/**
 * Transfer USDC from the agent wallet to a recipient address.
 * @param to  Recipient Tempo address
 * @param amountUsdc  Human-readable amount (e.g. 100.5 = 100.5 USDC)
 * @returns Transaction hash
 */
export async function transferUsdc(
  to: `0x${string}`,
  amountUsdc: number,
): Promise<`0x${string}`> {
  const amount = BigInt(Math.round(amountUsdc * 1e6))

  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [to, amount],
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    throw new Error(`USDC transfer reverted on-chain (tx ${hash}) — check agent wallet balance`)
  }
  return hash
}

/**
 * Read the agent wallet's current USDC balance (raw 6-decimal units).
 */
export async function getAgentUsdcBalance(): Promise<bigint> {
  return publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [ENV.AGENT_ACCESS_KEY_ADDRESS as `0x${string}`],
  })
}
