"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export type ChatwootState = {
  baseUrl: string
  accountId: string
  inboxId: string
  websiteToken: string
  hasApiToken: boolean
  hasHmacToken: boolean
}

export function ChatwootClient({ initial }: { initial: ChatwootState }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [accountId, setAccountId] = useState(initial.accountId)
  const [inboxId, setInboxId] = useState(initial.inboxId)
  const [websiteToken, setWebsiteToken] = useState(initial.websiteToken)
  const [apiToken, setApiToken] = useState("")
  const [hmacToken, setHmacToken] = useState("")

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const payload: Record<string, string> = { baseUrl, accountId, inboxId, websiteToken }
    // Only send secrets when the user typed something (empty = keep existing).
    if (apiToken) payload.apiToken = apiToken
    if (hmacToken) payload.hmacToken = hmacToken

    const res = await fetch("/api/tenant-admin/chatwoot", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || "Could not save")
      return
    }
    setSaved(true)
    setApiToken("")
    setHmacToken("")
    startTransition(() => router.refresh())
  }

  return (
    <Card>
      <CardContent className="pt-6">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {saved && (
          <Alert className="mb-4">
            <AlertDescription>Chatwoot settings saved and verified.</AlertDescription>
          </Alert>
        )}
        <form onSubmit={save} className="space-y-4">
          <Field>
            <FieldLabel htmlFor="cw-base">Base URL</FieldLabel>
            <Input id="cw-base" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://chat.yourbrand.com" required />
            <FieldDescription>Your Chatwoot installation, no trailing slash.</FieldDescription>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="cw-account">Account ID</FieldLabel>
              <Input id="cw-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="1" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="cw-inbox">Inbox ID</FieldLabel>
              <Input id="cw-inbox" value={inboxId} onChange={(e) => setInboxId(e.target.value)} placeholder="1" required />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="cw-website">Website token</FieldLabel>
            <Input id="cw-website" value={websiteToken} onChange={(e) => setWebsiteToken(e.target.value)} placeholder="Website channel token (drives the chat widget)" />
            <FieldDescription>Public token for the live-chat widget on your domain.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="cw-api">API access token</FieldLabel>
            <Input id="cw-api" type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder={initial.hasApiToken ? "•••••••• (leave blank to keep)" : "Agent/bot API access token"} />
          </Field>
          <Field>
            <FieldLabel htmlFor="cw-hmac">HMAC token (optional)</FieldLabel>
            <Input id="cw-hmac" type="password" value={hmacToken} onChange={(e) => setHmacToken(e.target.value)} placeholder={initial.hasHmacToken ? "•••••••• (leave blank to keep)" : "Identity-validation HMAC"} />
          </Field>
          <Button type="submit" variant="gradient" size="pill" disabled={pending}>
            Save & verify
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
