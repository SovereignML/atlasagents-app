import * as React from "react"
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react"

import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

type Tone = "primary" | "emerald" | "amber" | "rose" | "sky" | "violet"

// Icon-tile tints. Each renders a soft tinted square with a matching glyph and
// reads correctly in both the blue light shell and the black/lime dark shell.
const TONE_TILE: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
}

// Per-tone hue for the corner radial glow (the `.stat-glow` recipe reads
// --stat-glow). Mirrors the console chart accent set.
const TONE_GLOW: Record<Tone, string> = {
  primary: "var(--primary)",
  emerald: "#34d27b",
  amber: "#f59e0b",
  rose: "#f43f5e",
  sky: "#22d3ee",
  violet: "#a855f7",
}

export type StatCardProps = {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon: LucideIcon
  tone?: Tone
  trend?: { label: string; direction?: "up" | "down" | "neutral" }
  progress?: { value: number; max?: number }
  /** Paint the console radial-glow + faint grid background, tinted by `tone`. */
  glow?: boolean
  className?: string
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  trend,
  progress,
  glow = false,
  className,
}: StatCardProps) {
  const TrendIcon =
    trend?.direction === "down"
      ? ArrowDownRight
      : trend?.direction === "up"
        ? ArrowUpRight
        : null

  return (
    <Card
      size="sm"
      style={glow ? ({ "--stat-glow": TONE_GLOW[tone] } as React.CSSProperties) : undefined}
      className={cn(
        "gap-3 transition-all duration-200 hover:shadow-[var(--shadow-hover)] motion-reduce:transition-none",
        glow && "stat-glow",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3 px-5">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            TONE_TILE[tone]
          )}
        >
          <Icon className="size-5" />
        </div>
        {trend && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
              trend.direction === "down"
                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                : trend.direction === "up"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground"
            )}
          >
            {TrendIcon && <TrendIcon className="size-3" />}
            {trend.label}
          </span>
        )}
      </div>
      <div className="space-y-1 px-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </p>
        <p className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
          {value}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {progress && (
        <div className="px-5">
          <Progress value={progress.value} max={progress.max ?? 100} />
        </div>
      )}
    </Card>
  )
}
