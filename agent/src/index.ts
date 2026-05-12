import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') })

import { createServer } from 'node:http'
import { ENV } from './lib/env.js'
import { db } from './lib/supabase.js'
import { createRouter } from './lib/router.js'
import { registerOrderRoutes } from './routes/orders.js'
import { registerTradeRoutes } from './routes/trades.js'
import { startDepositMonitor } from './tempo/monitor.js'

async function main() {
  const { error } = await db.from('trades').select('id').limit(1)
  if (error) throw new Error(`Supabase connection failed: ${error.message}`)
  console.log('[agent] Supabase connected ✓')
  console.log('[agent] Environment validated ✓')

  const router = createRouter()

  router.get('/health', async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', version: '2.4.0' }))
  })

  registerOrderRoutes(router)
  registerTradeRoutes(router)

  const server = createServer((req, res) => router.handle(req, res))

  server.listen(ENV.PORT, () => {
    console.log(`[agent] Listening on port ${ENV.PORT} ✓`)
    console.log('[agent] Routes:')
    console.log('  POST /orders                      (public — mppx x402 fee at order creation)')
    console.log('  POST /orders/:id/cancel           (Bearer)')
    console.log('  POST /trades                      (Bearer)')
    console.log('  POST /trades/:id/payment-sent     (Bearer)')
    console.log('  POST /trades/:id/confirm-payment  (Bearer)')
    console.log('  POST /trades/:id/settle           (Bearer — deprecated, use payment-sent)')
  })

  const tokenAddress = ENV.TEMPO_PATHUSDC_ADDRESS as `0x${string}`
  await startDepositMonitor(tokenAddress)
  console.log('[agent] Deposit monitor started ✓')
  console.log('[agent] Ready')
}

main().catch((err) => {
  console.error('[agent] Fatal:', err)
  process.exit(1)
})
