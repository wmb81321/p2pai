'use client'

import { useRef, useState } from 'react'

const PAYMENT_METHODS = ['Zelle', 'Venmo', 'CashApp', 'Bank Transfer', 'Wire', 'Other'] as const

interface Props {
  tradeId: string
  buyerAddress: string
  usdAmount: number
  sellerPaymentMethods: Array<{ type: string; label: string; value: string }>
  onSent: () => void
}

export function PaymentSentForm({ tradeId, buyerAddress, usdAmount, sellerPaymentMethods, onSent }: Props) {
  const [method,      setMethod]      = useState('')
  const [reference,   setReference]   = useState('')
  const [proofUrl,    setProofUrl]    = useState('')
  const [uploading,   setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [submitting,  setSubmitting]  = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('trade_id', tradeId)
      fd.append('uploader_address', buyerAddress)
      const res = await fetch('/api/upload-proof', { method: 'POST', body: fd })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok) { setUploadError(data.error ?? 'Upload failed'); return }
      setProofUrl(data.url ?? '')
    } catch {
      setUploadError('Upload failed — please try again')
    } finally {
      setUploading(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!method)    { setError('Select a payment method'); return }
    if (!reference) { setError('Enter a reference or confirmation number'); return }

    setSubmitting(true)
    setError(null)

    try {
      const body: Record<string, string> = {
        buyer_address:     buyerAddress,
        payment_method:    method,
        payment_reference: reference,
      }
      if (proofUrl.trim()) body['payment_proof_url'] = proofUrl.trim()

      const res = await fetch(`/api/trades/${tradeId}/payment-sent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed to submit'); return }
      onSent()
    } catch {
      setError('Network error — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">

      {/* Seller payment info */}
      {sellerPaymentMethods.length > 0 && (
        <div className="space-y-2">
          <span className="font-mono text-[10px] text-dim uppercase tracking-widest">
            Send ${usdAmount.toFixed(2)} USD to
          </span>
          <div className="space-y-1.5">
            {sellerPaymentMethods.map((pm, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2 bg-canvas/60 rounded-lg border border-white/[0.06]"
              >
                <span className="font-mono text-[10px] text-dim/70 uppercase tracking-widest w-20 shrink-0">
                  {pm.type}
                </span>
                <div className="flex-1 min-w-0 text-right">
                  <p className="font-mono text-xs text-ink/80 truncate">{pm.value}</p>
                  {pm.label && pm.label !== pm.value && (
                    <p className="font-mono text-[10px] text-dim/50 truncate">{pm.label}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sellerPaymentMethods.length === 0 && (
        <p className="font-mono text-xs text-dim/60 bg-canvas/40 rounded-lg px-3 py-2 border border-white/[0.05]">
          Contact the seller to get their payment details, then fill in the form below.
        </p>
      )}

      {/* Method */}
      <label className="block space-y-1.5">
        <span className="font-mono text-[10px] text-dim uppercase tracking-widest">
          Payment method used
        </span>
        <div className="flex flex-wrap gap-1.5">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`px-2.5 py-1 rounded-md font-mono text-[10px] uppercase tracking-widest border transition-colors ${
                method === m
                  ? 'border-accent/60 bg-accent/10 text-accent'
                  : 'border-white/[0.07] text-dim/60 hover:text-ink hover:border-white/20'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </label>

      {/* Reference */}
      <label className="block space-y-1.5">
        <span className="font-mono text-[10px] text-dim uppercase tracking-widest">
          Confirmation / reference number
        </span>
        <input
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="e.g. ZELLE-123456 or transaction ID"
          maxLength={200}
          className="w-full bg-canvas border border-white/[0.07] rounded-lg px-3 py-2 font-mono text-xs text-ink placeholder:text-dim/30 outline-none focus:border-accent/30 transition-colors"
        />
      </label>

      {/* Proof — upload or URL */}
      <div className="space-y-1.5">
        <span className="font-mono text-[10px] text-dim uppercase tracking-widest">
          Proof of payment <span className="text-dim/40 normal-case">(optional)</span>
        </span>

        {/* File upload */}
        <div
          className="flex items-center gap-3 px-3 py-2.5 bg-canvas border border-dashed border-white/[0.12] rounded-lg cursor-pointer hover:border-white/25 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
          />
          {uploading ? (
            <span className="font-mono text-[10px] text-dim">Uploading…</span>
          ) : proofUrl ? (
            <span className="font-mono text-[10px] text-accent truncate flex-1">
              ✓ Image uploaded
            </span>
          ) : (
            <span className="font-mono text-[10px] text-dim/50">
              Click to upload screenshot (JPEG, PNG, WebP — max 5 MB)
            </span>
          )}
          {proofUrl && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setProofUrl(''); if (fileRef.current) fileRef.current.value = '' }}
              className="font-mono text-[10px] text-danger/60 hover:text-danger shrink-0"
            >
              remove
            </button>
          )}
        </div>

        {uploadError && (
          <p className="font-mono text-[10px] text-danger/70">{uploadError}</p>
        )}

        {/* Fallback: paste URL */}
        {!proofUrl && (
          <input
            type="url"
            value={proofUrl}
            onChange={(e) => setProofUrl(e.target.value)}
            placeholder="Or paste an image URL…"
            className="w-full bg-canvas border border-white/[0.07] rounded-lg px-3 py-2 font-mono text-xs text-ink placeholder:text-dim/30 outline-none focus:border-accent/30 transition-colors"
          />
        )}
      </div>

      {error && (
        <p className="font-mono text-[10px] text-danger/70">{error}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-2.5 rounded-lg bg-accent text-canvas font-mono text-xs font-semibold hover:bg-accent/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {submitting ? 'Submitting…' : `I've sent $${usdAmount.toFixed(2)} USD`}
      </button>
    </form>
  )
}
