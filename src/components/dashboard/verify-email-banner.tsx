"use client"

import { useState } from "react"
import { Mail, X } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

/**
 * Soft "verify your email" prompt shown in the dashboard for credentials users
 * whose `emailVerified` is still null. Dismissible for the session; offers a
 * resend that hits /api/auth/resend-verification (rate-limited server-side).
 */
export function VerifyEmailBanner() {
  const [dismissed, setDismissed] = useState(false)
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [message, setMessage] = useState("")

  if (dismissed) return null

  async function resend() {
    setStatus("sending")
    setMessage("")
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST" })
      const data = await res.json()
      if (res.ok) {
        setStatus("sent")
        setMessage("Verification email sent. Check your inbox.")
      } else {
        setStatus("error")
        setMessage(data.error || "Couldn't send. Try again later.")
      }
    } catch {
      setStatus("error")
      setMessage("Couldn't send. Try again later.")
    }
  }

  return (
    <Alert variant="warning" className="mb-6 flex flex-wrap items-center gap-3">
      <Mail className="shrink-0" />
      <AlertDescription className="min-w-0 flex-1 text-current">
        Please verify your email address to secure your account.
        {message && <span className="ml-2 opacity-80">{message}</span>}
      </AlertDescription>
      <Button
        variant="outline"
        size="sm"
        onClick={resend}
        disabled={status === "sending" || status === "sent"}
      >
        {status === "sending"
          ? "Sending…"
          : status === "sent"
            ? "Sent"
            : "Resend email"}
      </Button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="text-current opacity-60 transition-opacity hover:opacity-100"
      >
        <X className="size-4" />
      </button>
    </Alert>
  )
}
