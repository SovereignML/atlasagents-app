"use client"

// Cookie-consent banner. Shows until the user makes a choice; the decision is
// stored via /api/consent (cookie + persisted onto the User row when logged in).
// Marketing consent gates all server-side ad-conversion tracking — until it's
// granted, src/lib/ads transmits nothing to Meta/Google.

import { useState, useSyncExternalStore } from "react"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { CONSENT_COOKIE } from "@/lib/consent"

function hasDecision(): boolean {
  try {
    return document.cookie
      .split("; ")
      .some((c) => c.startsWith(`${CONSENT_COOKIE}=`))
  } catch {
    // document unavailable — treat as decided so the banner stays hidden.
    return true
  }
}

// The cookie is external mutable state, so it's read through
// useSyncExternalStore rather than copied into state from an effect. Nothing
// emits an event when a cookie changes, so `subscribe` is a no-op — the one
// change we make ourselves is tracked by the `dismissed` state below.
const subscribe = () => () => {}

// On the server, report "already decided" so the banner never renders during
// SSR. That preserves the original no-flash behavior without an effect.
const getServerSnapshot = () => true

export function ConsentBanner() {
  const [saving, setSaving] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const { status } = useSession()

  const decided = useSyncExternalStore(subscribe, hasDecision, getServerSnapshot)

  // Login-gated: only prompt signed-in users (never on the public landing page).
  const open = status === "authenticated" && !decided && !dismissed

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
      setSaving(false)
      setDismissed(true)
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
