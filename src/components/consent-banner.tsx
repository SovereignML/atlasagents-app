"use client"

// Cookie-consent banner. Shows until the user makes a choice; the decision is
// stored via /api/consent (cookie + persisted onto the User row when logged in).
// Marketing consent gates all server-side ad-conversion tracking — until it's
// granted, src/lib/ads transmits nothing to Meta/Google.

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { CONSENT_COOKIE } from "@/lib/consent"

function hasDecision(): boolean {
  return document.cookie
    .split("; ")
    .some((c) => c.startsWith(`${CONSENT_COOKIE}=`))
}

export function ConsentBanner() {
  // Start hidden to avoid an SSR/CSR flash; reveal only if no decision exists.
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const { status } = useSession()

  // Login-gated: only prompt signed-in users (never on the public landing page).
  // Re-runs when auth resolves, so the banner appears right after sign-in.
  useEffect(() => {
    if (status !== "authenticated") {
      setOpen(false)
      return
    }
    try {
      if (!hasDecision()) setOpen(true)
    } catch {
      // document unavailable — leave hidden.
    }
  }, [status])

  async function decide(marketing: boolean) {
    setSaving(true)
    try {
      await fetch("/api/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketing, analytics: marketing }),
      })
    } catch {
      // Best-effort; the cookie set server-side is the source of truth.
    } finally {
      setOpen(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        role="dialog"
        aria-label="Cookie consent"
        className="flex max-w-sm flex-col items-center gap-2 rounded-lg border border-border bg-background/95 p-3 text-center shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80"
      >
        <p className="text-xs text-muted-foreground">
          We use cookies to measure ad performance.{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy
          </Link>
        </p>
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => decide(false)}
          >
            Decline
          </Button>
          <Button size="sm" disabled={saving} onClick={() => decide(true)}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  )
}
