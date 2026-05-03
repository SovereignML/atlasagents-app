"use client"

import { useState } from "react"

export function BillingPortalButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function openPortal() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch("/api/billing/portal", { method: "POST" })
      const j = (await r.json()) as { url?: string; error?: string }
      if (!r.ok || !j.url) {
        setError(j.error || "Could not open billing portal")
        return
      }
      window.location.href = j.url
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
      <p className="text-[10px] uppercase tracking-[0.1em] font-mono text-[var(--text-secondary)]">
        Payment Method
      </p>
      <p className="text-sm text-[var(--text-secondary)] mt-3">
        Manage your card, invoices, and subscriptions via the Stripe billing portal.
      </p>
      <button
        onClick={openPortal}
        disabled={loading}
        className="w-full text-xs mt-4 py-2 rounded-xl border border-[var(--border-color)] text-[var(--text-primary)] font-mono uppercase tracking-[0.08em] hover:border-[var(--accent-color)] disabled:opacity-50"
      >
        {loading ? "Opening…" : "Manage Billing"}
      </button>
      {error && <p className="text-[10px] font-mono text-red-400 mt-2">{error}</p>}
    </div>
  )
}
