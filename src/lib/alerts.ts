// Alert-rule evaluation. The alerts-eval cron calls evaluateAlertRules(); for
// each enabled rule it resolves the target agents (one instance, or every agent
// in the team when instanceId is null = fleet-wide), checks the metric, and —
// if any target breaches and the rule is out of cooldown — fires through the
// shared notify() dispatcher under the "monitoring" category.
//
// Metrics read the same real fields the dashboard shows (Kuma snapshot + per-
// instance OpenRouter spend); error_rate reads the AgentEvent stream (no
// events, no rate, until the emit pipeline is live).

import { db, alertRules, instances, agentEvents, and, eq, ne, gte, inArray, sql } from "@/db"
import { notify } from "@/lib/notifications/dispatch"
import { ERROR_RATE_EVENT_TYPES, compare, errorRate } from "@/lib/alert-metrics"

type TargetRow = {
  id: string
  name: string
  status: string
  kumaStatus: string | null
  kumaResponseTimeMs: number | null
  kumaUptimeRatio: number | null
  openRouterUsageUsd: number
}

type AlertRuleRow = typeof alertRules.$inferSelect

function metricLabel(rule: AlertRuleRow): string {
  switch (rule.metric) {
    case "down":
      return "is down"
    case "latency_ms":
      return `latency ${rule.comparator === "gt" ? ">" : "<"} ${rule.threshold} ms`
    case "uptime_ratio":
      return `uptime ${rule.comparator === "gt" ? ">" : "<"} ${(rule.threshold * 100).toFixed(1)}%`
    case "cost_usd_period":
      return `spend ${rule.comparator === "gt" ? ">" : "<"} $${rule.threshold.toFixed(2)}`
    case "error_rate":
      return `error rate ${rule.comparator === "gt" ? ">" : "<"} ${(rule.threshold * 100).toFixed(0)}%`
    default:
      return rule.metric
  }
}

// Returns true if this target breaches the rule's threshold right now.
async function breaches(rule: AlertRuleRow, t: TargetRow, since: Date): Promise<boolean> {
  switch (rule.metric) {
    case "down":
      return t.kumaStatus === "down"
    case "latency_ms":
      return t.kumaResponseTimeMs != null && compare(t.kumaResponseTimeMs, rule.comparator, rule.threshold)
    case "uptime_ratio":
      return t.kumaUptimeRatio != null && compare(t.kumaUptimeRatio, rule.comparator, rule.threshold)
    case "cost_usd_period":
      // Cumulative per-instance spend for now (windowed deltas land with the
      // event pipeline). Compared against the configured USD threshold.
      return compare(t.openRouterUsageUsd ?? 0, rule.comparator, rule.threshold)
    case "error_rate": {
      // Failures arrive as type "error" events as well as status "error" on a
      // run or tool call. Counting only the latter (as this used to) left the
      // ratio at 0 for every agent, so the rule could never fire.
      const [row] = await db
        .select({
          total: sql<number>`count(*)::int`,
          failed: sql<number>`count(*) filter (where ${agentEvents.type} = 'error' or ${agentEvents.status} = 'error')::int`,
        })
        .from(agentEvents)
        .where(
          and(
            eq(agentEvents.instanceId, t.id),
            gte(agentEvents.createdAt, since),
            inArray(agentEvents.type, [...ERROR_RATE_EVENT_TYPES]),
          ),
        )
      const rate = row ? errorRate(row) : null
      return rate != null && compare(rate, rule.comparator, rule.threshold)
    }
    default:
      return false
  }
}

export type AlertEvalReport = {
  rules: number
  evaluated: number
  fired: number
}

export async function evaluateAlertRules(): Promise<AlertEvalReport> {
  const rules = await db.query.alertRules.findMany({ where: eq(alertRules.enabled, true) })
  const now = new Date()
  let evaluated = 0
  let fired = 0

  for (const rule of rules) {
    // Respect cooldown — don't re-alert on a still-breaching condition.
    if (
      rule.lastFiredAt &&
      now.getTime() - rule.lastFiredAt.getTime() < rule.cooldownMinutes * 60_000
    ) {
      continue
    }

    const targets = (await db.query.instances.findMany({
      where: rule.instanceId
        ? and(eq(instances.id, rule.instanceId), ne(instances.status, "deleted"))
        : and(eq(instances.teamId, rule.teamId), ne(instances.status, "deleted")),
      columns: {
        id: true,
        name: true,
        status: true,
        kumaStatus: true,
        kumaResponseTimeMs: true,
        kumaUptimeRatio: true,
        openRouterUsageUsd: true,
      },
    })) as TargetRow[]

    const since = new Date(now.getTime() - rule.windowMinutes * 60_000)
    const breachedNames: string[] = []
    for (const t of targets) {
      evaluated++
      if (await breaches(rule, t, since)) breachedNames.push(t.name)
    }

    if (breachedNames.length === 0) continue

    const scope =
      breachedNames.length === 1
        ? `"${breachedNames[0]}"`
        : `${breachedNames.length} agents (${breachedNames.slice(0, 3).join(", ")}${
            breachedNames.length > 3 ? "…" : ""
          })`

    await notify({
      userId: rule.createdBy,
      category: "monitoring",
      type: `alert_${rule.metric}`,
      title: `Alert: ${metricLabel(rule)}`,
      message: `${scope} ${breachedNames.length === 1 ? "breached" : "breach"} your alert rule (${metricLabel(rule)}).`,
      instanceId: rule.instanceId ?? undefined,
      url: "/dashboard/monitoring",
    })

    await db.update(alertRules).set({ lastFiredAt: now }).where(eq(alertRules.id, rule.id))
    fired++
  }

  return { rules: rules.length, evaluated, fired }
}
