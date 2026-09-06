"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Send } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Toggle } from "@/components/ui/toggle"
import {
  CATEGORIES,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  CHANNEL_LABELS,
  CHANNELS,
  resolveMatrix,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationMatrix,
} from "@/lib/notifications/types"
import { BRANDING } from "@/configs/branding"

export function NotificationPreferencesCard() {
  const [matrix, setMatrix] = useState<NotificationMatrix>(() => resolveMatrix(null))
  const [discordUrl, setDiscordUrl] = useState("")
  const [slackUrl, setSlackUrl] = useState("")
  const [telegramLinked, setTelegramLinked] = useState(false)
  const [telegramAvailable, setTelegramAvailable] = useState(false)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [success, setSuccess] = useState("")
  const [error, setError] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadPrefs = useCallback(async () => {
    const res = await fetch("/api/notifications/preferences", { credentials: "include" })
    if (!res.ok) return null
    const data = await res.json()
    setMatrix(resolveMatrix(data.matrix))
    setDiscordUrl(data.discordWebhookUrl ?? "")
    setSlackUrl(data.slackWebhookUrl ?? "")
    setTelegramLinked(!!data.telegramLinked)
    setTelegramAvailable(!!data.telegramAvailable)
    return data as { telegramLinked: boolean }
  }, [])

  useEffect(() => {
    void loadPrefs().finally(() => setLoading(false))
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [loadPrefs])

  // A channel cell is interactive only once that channel can actually deliver.
  function channelEnabled(ch: NotificationChannel): boolean {
    if (ch === "telegram") return telegramLinked
    if (ch === "discord") return discordUrl.trim().length > 0
    if (ch === "slack") return slackUrl.trim().length > 0
    return true // inApp, email
  }

  function setCell(cat: NotificationCategory, ch: NotificationChannel, on: boolean) {
    setMatrix((prev) => ({ ...prev, [cat]: { ...prev[cat], [ch]: on } }))
  }

  async function handleSave() {
    setSaving(true)
    setSuccess("")
    setError("")
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matrix, discordWebhookUrl: discordUrl, slackWebhookUrl: slackUrl }),
      })
      const data = await res.json()
      if (res.ok) setSuccess(data.message ?? "Saved")
      else setError(data.error ?? "Failed to save")
    } catch {
      setError("Failed to save preferences")
    } finally {
      setSaving(false)
    }
  }

  async function connectTelegram() {
    setConnecting(true)
    setError("")
    try {
      const res = await fetch("/api/notifications/telegram/link", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Could not start Telegram connection")
        return
      }
      window.open(data.url, "_blank", "noopener,noreferrer")
      // Poll for the webhook to capture the chat id after the user taps Start.
      let tries = 0
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        tries++
        const d = await loadPrefs()
        if (d?.telegramLinked || tries >= 20) {
          if (pollRef.current) clearInterval(pollRef.current)
          setConnecting(false)
        }
      }, 3000)
    } catch {
      setError("Could not start Telegram connection")
      setConnecting(false)
    }
  }

  async function disconnectTelegram() {
    await fetch("/api/notifications/telegram/link", { method: "DELETE" }).catch(() => {})
    setTelegramLinked(false)
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Notifications</CardTitle>
        <CardDescription>
          Choose how you want to be notified for each kind of event.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Preference matrix */}
        <div className="overflow-x-auto">
          <div className="min-w-[480px]">
            <div
              className="grid items-center gap-2 border-b pb-2 text-xs font-medium text-muted-foreground"
              style={{ gridTemplateColumns: `1.6fr repeat(${CHANNELS.length}, 1fr)` }}
            >
              <span>Event</span>
              {CHANNELS.map((ch) => (
                <span key={ch} className="text-center">
                  {CHANNEL_LABELS[ch]}
                </span>
              ))}
            </div>
            {CATEGORIES.map((cat) => (
              <div
                key={cat}
                className="grid items-center gap-2 border-b py-3"
                style={{ gridTemplateColumns: `1.6fr repeat(${CHANNELS.length}, 1fr)` }}
              >
                <div className="pr-2">
                  <div className="text-sm font-medium">{CATEGORY_LABELS[cat]}</div>
                  <div className="text-xs text-muted-foreground">{CATEGORY_DESCRIPTIONS[cat]}</div>
                </div>
                {CHANNELS.map((ch) => {
                  const enabled = channelEnabled(ch)
                  const on = matrix[cat][ch]
                  return (
                    <div key={ch} className="flex justify-center">
                      <Toggle
                        size="sm"
                        variant="outline"
                        pressed={on}
                        disabled={!enabled}
                        onPressedChange={(p) => setCell(cat, ch, p)}
                        aria-label={`${CATEGORY_LABELS[cat]} via ${CHANNEL_LABELS[ch]}`}
                        title={!enabled ? `Connect ${CHANNEL_LABELS[ch]} below first` : undefined}
                      >
                        {on ? <Check /> : null}
                      </Toggle>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Channel connections */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Telegram</div>
              <div className="text-xs text-muted-foreground">
                {telegramLinked
                  ? `Connected to the ${BRANDING.name} notifications bot.`
                  : telegramAvailable
                    ? "Connect to receive alerts in Telegram."
                    : "Telegram notifications are not configured on this server."}
              </div>
            </div>
            {telegramLinked ? (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1">
                  <Check className="size-3" /> Connected
                </Badge>
                <Button variant="ghost" size="sm" onClick={disconnectTelegram}>
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={connectTelegram}
                disabled={!telegramAvailable || connecting}
              >
                <Send data-icon="inline-start" />
                {connecting ? "Waiting…" : "Connect Telegram"}
              </Button>
            )}
          </div>

          <Field>
            <FieldLabel htmlFor="discord-webhook">Discord webhook URL</FieldLabel>
            <Input
              id="discord-webhook"
              value={discordUrl}
              onChange={(e) => setDiscordUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="slack-webhook">Slack webhook URL</FieldLabel>
            <Input
              id="slack-webhook"
              value={slackUrl}
              onChange={(e) => setSlackUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
            />
          </Field>
        </div>

        {success && (
          <Alert>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Preferences"}
        </Button>
      </CardContent>
    </Card>
  )
}
