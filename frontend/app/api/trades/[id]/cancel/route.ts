import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const agentUrl = process.env.FACILITATOR_URL
  if (!agentUrl) return NextResponse.json({ error: 'Agent not configured' }, { status: 503 })

  const body = await req.text()
  let agentRes: Response
  try {
    agentRes = await fetch(`${agentUrl}/trades/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
    })
  } catch {
    return NextResponse.json({ error: 'Agent unreachable' }, { status: 502 })
  }

  const text = await agentRes.text()
  let data: unknown
  try { data = JSON.parse(text) } catch {
    return NextResponse.json({ error: `Agent error (${agentRes.status})` }, { status: 502 })
  }
  return NextResponse.json(data, { status: agentRes.status })
}
