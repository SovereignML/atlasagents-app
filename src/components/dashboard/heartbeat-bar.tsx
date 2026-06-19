import { cn } from "@/lib/utils"

// A single status reading from the Uptime Kuma heartbeat history. `status` null
// means "we polled but Kuma reported nothing"; a missing bar (left-padding)
// means "no data for this slot yet".
export type HeartbeatSample = {
  status: string | null
  responseTimeMs: number | null
  checkedAt: string
}

const BAR_TONE: Record<string, string> = {
  up: "bg-emerald-500",
  down: "bg-destructive",
  pending: "bg-amber-500",
  maintenance: "bg-amber-500",
}

function tone(status: string | null): string {
  return (status && BAR_TONE[status]) || "bg-muted"
}

function barTitle(s: HeartbeatSample): string {
  const when = new Date(s.checkedAt).toLocaleString()
  const label = s.status ? s.status.charAt(0).toUpperCase() + s.status.slice(1) : "No data"
  const rt = s.responseTimeMs != null ? ` · ${s.responseTimeMs} ms` : ""
  return `${label}${rt}, ${when}`
}

/**
 * The signature Uptime-Kuma heartbeat strip: a row of thin rounded bars, one per
 * recent check, green=up / red=down / amber=degraded / muted=no-data. Renders
 * oldest→newest left→right and left-pads with empty slots so a short history
 * still looks like the full strip.
 *
 * Pure/server component — pass the most recent `count` samples (any order is
 * fine; they're sorted ascending by checkedAt here).
 */
export function HeartbeatBar({
  samples,
  count = 40,
  size = "md",
}: {
  samples: HeartbeatSample[]
  count?: number
  size?: "sm" | "md"
}) {
  const sorted = [...samples]
    .sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime())
    .slice(-count)
  const padding = Math.max(0, count - sorted.length)
  const barH = size === "sm" ? "h-4" : "h-7"
  const barW = size === "sm" ? "w-[3px]" : "w-1"
  const gap = size === "sm" ? "gap-[2px]" : "gap-[3px]"
  const radius = size === "sm" ? "rounded-[1px]" : "rounded-full"

  return (
    <div className={cn("flex items-end", gap)} aria-hidden="true">
      {Array.from({ length: padding }).map((_, i) => (
        <span key={`pad-${i}`} className={cn(barW, barH, radius, "bg-muted/40")} />
      ))}
      {sorted.map((s, i) => (
        <span
          key={`${s.checkedAt}-${i}`}
          title={barTitle(s)}
          className={cn(barW, barH, radius, tone(s.status))}
        />
      ))}
    </div>
  )
}
