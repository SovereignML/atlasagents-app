import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "ghost"

type StatusMeta = {
  label: string
  variant: BadgeVariant
  /** Extra classes for tones the base variants don't cover (e.g. amber). */
  className?: string
}

const AMBER = "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"

/**
 * Single source of truth for status → badge styling across the admin console.
 * Covers instance statuses, warm-VM (pre-baked) statuses, subscription
 * statuses, provider-health states, and computed health tiers. Unknown values
 * fall back to a neutral secondary badge with the raw string.
 */
const STATUS_MAP: Record<string, StatusMeta> = {
  // Health tiers (computed)
  healthy: { label: "Healthy", variant: "default" },
  at_risk: { label: "At Risk", variant: "outline", className: AMBER },
  churn_risk: { label: "Churn Risk", variant: "destructive" },

  // Instance lifecycle
  running: { label: "running", variant: "default" },
  stopped: { label: "stopped", variant: "secondary" },
  provisioning: { label: "provisioning", variant: "outline", className: AMBER },
  pending: { label: "pending", variant: "outline", className: AMBER },
  failed: { label: "failed", variant: "destructive" },
  failed_provisioning: { label: "failed_provisioning", variant: "destructive" },
  deleting: { label: "deleting", variant: "destructive" },
  deleted: { label: "deleted", variant: "secondary" },

  // Warm-VM (pre-baked) lifecycle
  creating: { label: "creating", variant: "outline", className: AMBER },
  bootstrapping: { label: "bootstrapping", variant: "outline", className: AMBER },
  ready: { label: "ready", variant: "default" },
  claimed: { label: "claimed", variant: "outline" },

  // Subscription
  active: { label: "active", variant: "default" },
  trialing: { label: "trialing", variant: "outline" },
  past_due: { label: "past_due", variant: "outline", className: AMBER },
  canceled: { label: "canceled", variant: "destructive" },
  incomplete: { label: "incomplete", variant: "secondary" },

  // Provider / uptime health
  up: { label: "up", variant: "default" },
  degraded: { label: "degraded", variant: "outline", className: AMBER },
  down: { label: "down", variant: "destructive" },
  maintenance: { label: "maintenance", variant: "secondary" },
}

export function statusMeta(status: string): StatusMeta {
  return STATUS_MAP[status] ?? { label: status, variant: "secondary" }
}

/** Map a status to just its Badge variant (for callers rendering their own Badge). */
export function statusVariant(status: string): BadgeVariant {
  return statusMeta(status).variant
}

export function StatusBadge({
  status,
  label,
  mono = false,
  className,
}: {
  status: string
  /** Override the display label (defaults to the mapped label). */
  label?: string
  /** Render the label in a monospace font (used for raw lifecycle statuses). */
  mono?: boolean
  className?: string
}) {
  const meta = statusMeta(status)
  return (
    <Badge
      variant={meta.variant}
      className={cn(meta.className, mono && "font-mono", className)}
    >
      {label ?? meta.label}
    </Badge>
  )
}
