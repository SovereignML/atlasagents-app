"use client"

import { useState } from "react"
import { ExternalLink, Loader2 } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"

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
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] tracking-[0.1em] uppercase">
          Payment Method
        </CardDescription>
        <p className="text-sm text-muted-foreground">
          Manage your card, invoices, and subscriptions via the Stripe billing portal.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button variant="outline" className="w-full" onClick={openPortal} disabled={loading}>
          {loading ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <ExternalLink data-icon="inline-start" />}
          {loading ? "Opening…" : "Manage Billing"}
        </Button>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
