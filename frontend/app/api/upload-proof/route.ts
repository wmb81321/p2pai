import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

const BUCKET = 'payment-proofs'
const MAX_MB = 5

// Extension derived from MIME type — never from user-controlled filename.
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
}

export async function POST(req: NextRequest) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file        = formData.get('file')
  const tradeId     = formData.get('trade_id')
  const uploaderRaw = formData.get('uploader_address')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (typeof tradeId !== 'string' || !tradeId) {
    return NextResponse.json({ error: 'trade_id is required' }, { status: 400 })
  }
  if (typeof uploaderRaw !== 'string' || !/^0x[0-9a-fA-F]{40}$/i.test(uploaderRaw)) {
    return NextResponse.json({ error: 'uploader_address is required' }, { status: 400 })
  }

  const uploaderAddr = uploaderRaw.toLowerCase()

  // Verify the uploader is a party to this trade.
  const db = createServerClient()
  const { data: trade } = await db
    .from('trades')
    .select('buyer_address, seller_address')
    .eq('id', tradeId)
    .single()

  if (!trade) {
    return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
  }
  if (
    trade.buyer_address.toLowerCase()  !== uploaderAddr &&
    trade.seller_address.toLowerCase() !== uploaderAddr
  ) {
    return NextResponse.json({ error: 'Not a party to this trade' }, { status: 403 })
  }

  if (file.size > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `File too large (max ${MAX_MB} MB)` }, { status: 413 })
  }

  const ext = MIME_TO_EXT[file.type]
  if (!ext) {
    return NextResponse.json({ error: 'Only JPEG, PNG, WebP, or GIF images allowed' }, { status: 415 })
  }

  const name = `${tradeId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { error } = await db.storage.from(BUCKET).upload(name, file, {
    contentType: file.type,
    upsert: false,
  })

  if (error) {
    console.error('[upload-proof]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: urlData } = db.storage.from(BUCKET).getPublicUrl(name)
  return NextResponse.json({ url: urlData.publicUrl })
}
