"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * Invisible helper that re-fetches the current server component tree on an
 * interval via router.refresh(). Paired with the server-side self-driving Kuma
 * sync, this keeps the uptime badges / heartbeat bars live without a manual
 * reload. Pauses while the tab is hidden to avoid pointless work.
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh()
    }
    const id = setInterval(tick, intervalMs)
    return () => clearInterval(id)
  }, [router, intervalMs])

  return null
}
