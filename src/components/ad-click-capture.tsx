"use client"

// Captures ad click IDs (fbclid/gclid) from the landing URL into a first-party
// cookie via /api/ads/click. Mounted app-wide so it fires on whatever page the
// ad lands on. Nothing is sent to Meta/Google here — that happens server-side at
// conversion time, gated on consent. See src/lib/ads.

import { useEffect } from "react"

const GUARD_KEY = "sov_ad_click_sent"

export function AdClickCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const fbclid = params.get("fbclid")?.trim()
      const gclid = params.get("gclid")?.trim()
      if (!fbclid && !gclid) return

      // Avoid re-POSTing on every client navigation within the same tab.
      const signature = `${fbclid ?? ""}|${gclid ?? ""}`
      if (sessionStorage.getItem(GUARD_KEY) === signature) return
      sessionStorage.setItem(GUARD_KEY, signature)

      void fetch("/api/ads/click", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fbclid, gclid }),
        keepalive: true,
      }).catch(() => {})
    } catch {
      // sessionStorage/URL unavailable — capture is best-effort.
    }
  }, [])

  return null
}
