import { z } from 'zod'

const hex40 = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be 0x-prefixed 20-byte address')
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be 0x-prefixed 32-byte hex')

const schema = z.object({
  // Tempo chain
  TEMPO_RPC_URL:          z.string().url(),
  TEMPO_TESTNET_RPC_URL:  z.string().url().optional(),
  TEMPO_CHAIN_ID:         z.coerce.number().default(42431),
  TEMPO_PATHUSDC_ADDRESS: hex40,

  // Agent wallet (EOA access key — NOT the passkey wallet)
  AGENT_MASTER_ID:          z.string().regex(/^0x[0-9a-fA-F]+$/),
  AGENT_MASTER_SALT:        z.string().regex(/^0x[0-9a-fA-F]+$/),
  AGENT_ACCESS_KEY:         hex32,
  AGENT_ACCESS_KEY_ADDRESS: hex40,

  // Supabase (service-role — agent only, never browser)
  SUPABASE_URL:              z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),

  // Agent runtime
  PORT:               z.coerce.number().default(3001),
  CHARGE_AMOUNT_USDC: z.coerce.number().default(0.1),
  // Used by mppx to HMAC-bind challenge IDs (stateless verification)
  MPP_SECRET_KEY:     z.string().min(16),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

const result = schema.safeParse(process.env)

if (!result.success) {
  console.error('[env] Invalid or missing environment variables:')
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const ENV = result.data
