import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address')
  if (!address || !/^0x[0-9a-fA-F]{40}$/i.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }

  const addrLower = address.toLowerCase()
  const db = createServerClient()
  const { data, error } = await db
    .from('trades')
    .select('*')
    .or(`buyer_address.eq.${addrLower},seller_address.eq.${addrLower}`)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
