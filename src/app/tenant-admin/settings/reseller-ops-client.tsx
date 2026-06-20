"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export type ResellerOpsState = {
  connectAccountId: string | null
  chargesEnabled: boolean
  payoutsEnabled: boolean
  hasOpenRouterKey: boolean
}

export function ResellerOpsClient({ initial }: { initial: ResellerOpsState }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [orKey, setOrKey] = useState("")
  const [orSaved, setOrSaved] = useState(false)

  async function connect() {
    setError(null)
    const res = await fetch("/api/tenant-admin/billing/connect", { method: "POST" })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || "Could not start Stripe onboarding")
      return
    }
    const { url } = await res.json()
    if (url) window.location.href = url
  }

  async function refreshStatus() {
    setError(null)
    await fetch("/api/tenant-admin/billing/connect")
    startTransition(() => router.refresh())
  }

  async function saveOrKey(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setOrSaved(false)
    const res = await fetch("/api/tenant-admin/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: orKey }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || "Could not save")
      return
    }
    setOrKey("")
    setOrSaved(true)
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Stripe Connect
            {initial.chargesEnabled ? (
              <Badge variant="default">Ready</Badge>
            ) : initial.connectAccountId ? (
              <Badge variant="outline">Onboarding</Badge>
            ) : (
              <Badge variant="secondary">Not connected</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Your customers pay you directly on your own Stripe account. We take no cut of their
            payments, only your platform plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button variant="gradient" size="pill" disabled={pending} onClick={connect}>
            {initial.connectAccountId ? "Continue onboarding" : "Connect Stripe"}
          </Button>
          {initial.connectAccountId && (
            <Button variant="outline" size="pill" disabled={pending} onClick={refreshStatus}>
              Refresh status
            </Button>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            OpenRouter account
            {initial.hasOpenRouterKey ? (
              <Badge variant="default">Set</Badge>
            ) : (
              <Badge variant="secondary">Not set</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Your customers&apos; agents run on your OpenRouter account, so you carry their LLM cost.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {orSaved && (
            <Alert className="mb-3">
              <AlertDescription>OpenRouter key saved.</AlertDescription>
            </Alert>
          )}
          <form onSubmit={saveOrKey} className="space-y-3">
            <Field>
              <FieldLabel htmlFor="or-key">Provisioning key</FieldLabel>
              <Input
                id="or-key"
                type="password"
                value={orKey}
                onChange={(e) => setOrKey(e.target.value)}
                placeholder={initial.hasOpenRouterKey ? "•••••••• (leave blank to keep)" : "sk-or-v1-..."}
              />
              <FieldDescription>
                An OpenRouter key with provisioning scope. Used to mint per-agent runtime keys.
              </FieldDescription>
            </Field>
            <Button type="submit" variant="outline" size="pill" disabled={pending || !orKey}>
              Save key
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
