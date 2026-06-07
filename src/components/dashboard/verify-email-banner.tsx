"use client"

import { useState } from "react"
import { Mail, X } from "lucide-react"

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
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
      <Mail className="size-4 shrink-0" />
      <span className="flex-1 min-w-0">
        Please verify your email address to secure your account.
        {message && <span className="ml-2 text-yellow-100/80">{message}</span>}
      </span>
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
        className="text-yellow-200/60 hover:text-yellow-100"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
