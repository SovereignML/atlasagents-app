import Link from "next/link"

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type StatTone = "default" | "accent" | "positive" | "warning" | "danger" | "muted"

const TONE_CLASS: Record<StatTone, string> = {
  default: "text-foreground",
  accent: "text-primary",
  positive: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
  muted: "text-muted-foreground",
}

/**
 * Consolidated metric card used across the admin console (dashboard, revenue,
 * billing, pool health). Replaces the per-page inline stat-card markup. When
 * `href` is set the whole card becomes a link with a hover affordance.
 */
export function StatCard({
  label,
  value,
  tone = "default",
  hint,
  href,
  className,
}: {
  label: string
  value: React.ReactNode
  tone?: StatTone
  hint?: React.ReactNode
  href?: string
  className?: string
}) {
  const card = (
    <Card
      size="sm"
      className={cn(href && "transition-colors hover:bg-accent/40", className)}
    >
      <CardHeader>
        <CardDescription className="text-xs">{label}</CardDescription>
        <CardTitle className={cn("text-3xl font-bold", TONE_CLASS[tone])}>
          {value}
        </CardTitle>
        {hint != null && (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        )}
      </CardHeader>
    </Card>
  )

  return href ? (
    <Link href={href} className="block">
      {card}
    </Link>
  ) : (
    card
  )
}
