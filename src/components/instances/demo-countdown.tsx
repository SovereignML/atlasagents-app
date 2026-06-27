"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Clock } from "lucide-react"
import { Badge } from "@/components/ui/badge"

const WARN_THRESHOLD_MS = 5 * 60 * 1000 // turn amber under 5 min remaining

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${mm}:${ss.toString().padStart(2, "0")}`
}

/**
 * Live "demo expires in MM:SS" badge for Free-tier (demo) agents. Ticks every
 * second; once it hits zero it asks the server to re-render (the reaper will
 * have torn the agent down by then). Render only when the instance has a
 * non-null `expiresAt`.
 */
export function DemoCountdown({ expiresAt }: { expiresAt: string }) {
  const router = useRouter()
  // Null until mounted so SSR and the first client render match (avoids a
  // hydration mismatch from server-vs-client clocks). The interval fills it in.
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  const refreshedRef = useRef(false)

  useEffect(() => {
    const deadline = new Date(expiresAt).getTime()
    const tick = () => {
      const left = deadline - Date.now()
      setRemainingMs(left)
      if (left <= 0 && !refreshedRef.current) {
        refreshedRef.current = true
        router.refresh()
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt, router])

  const expired = remainingMs !== null && remainingMs <= 0
  const warn = remainingMs !== null && remainingMs <= WARN_THRESHOLD_MS

  return (
    <Badge
      variant={warn ? "destructive" : "secondary"}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[13px] font-mono tabular-nums"
      title="This is a demo agent. It is automatically removed when the timer reaches zero."
    >
      <Clock className="size-3" />
      {remainingMs === null
        ? "Demo · --:--"
        : expired
          ? "Demo · expiring…"
          : `Demo · ${formatMs(remainingMs)}`}
    </Badge>
  )
}
