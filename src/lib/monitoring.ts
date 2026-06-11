// Monitoring summary — the real data behind /dashboard/monitoring. Follows the
// direct-drizzle-in-server-component pattern (see src/app/dashboard/page.tsx):
// the page calls getMonitoringSummary(userId) and renders the result.
//
// Every figure here is REAL: uptime/latency/cert come from the Uptime Kuma
// snapshot the uptime-sync poller writes onto each instance; cost is the
// per-instance OpenRouter spend the usage-sync poller tracks; incidents are
// error-level InstanceLog rows; run counts come from AgentEvent once the agent
// emit pipeline is live (0 until then — never synthesized).

import { db, instanceLogs, agentEvents, and, eq, gte, inArray, sql } from "@/db"
import { whereUserInstancesVisible } from "@/lib/instance-queries"

export type MonitoringAgent = {
  id: string
  name: string
  slug: string
  status: string
  deploymentTarget: string | null
  runtime: string | null
  kumaStatus: string | null
  uptimeRatio24h: number | null
  latencyMs: number | null
  certDaysRemaining: number | null
  lastCheckAt: string | null
  costUsd: number
  runs24h: number
  lastEventAt: string | null
}

export type MonitoringSummary = {
  fleet: {
    total: number
    running: number
    incidents24h: number
    avgLatencyMs: number | null
  }
  agents: MonitoringAgent[]
}

export async function getMonitoringSummary(userId: string): Promise<MonitoringSummary> {
  const rows = await db.query.instances.findMany({
    where: whereUserInstancesVisible(userId),
    columns: {
      id: true,
      name: true,
      slug: true,
      status: true,
      deploymentTarget: true,
      runtime: true,
      kumaStatus: true,
      kumaResponseTimeMs: true,
      kumaUptimeRatio: true,
      kumaCertDaysRemaining: true,
      kumaCheckedAt: true,
      openRouterUsageUsd: true,
      lastEventAt: true,
    },
    orderBy: (t, { desc }) => desc(t.createdAt),
  })

  const ids = rows.map((r) => r.id)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

  // Real "incidents" = error-level instance logs in the last 24h, and run
  // counts per agent from the event stream. Both guarded on a non-empty id set
  // (inArray([]) is an error in SQL).
  let incidents24h = 0
  const runs = new Map<string, number>()
  if (ids.length > 0) {
    const [incidentRow] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(instanceLogs)
      .where(
        and(
          inArray(instanceLogs.instanceId, ids),
          eq(instanceLogs.level, "error"),
          gte(instanceLogs.createdAt, since),
        ),
      )
    incidents24h = incidentRow?.c ?? 0

    const runRows = await db
      .select({ instanceId: agentEvents.instanceId, c: sql<number>`count(*)::int` })
      .from(agentEvents)
      .where(
        and(
          inArray(agentEvents.instanceId, ids),
          eq(agentEvents.type, "run.finished"),
          gte(agentEvents.createdAt, since),
        ),
      )
      .groupBy(agentEvents.instanceId)
    for (const r of runRows) runs.set(r.instanceId, r.c)
  }

  // Avg latency across running agents that have a Kuma reading.
  const latencies = rows
    .filter((r) => r.status === "running" && r.kumaResponseTimeMs != null)
    .map((r) => r.kumaResponseTimeMs as number)
  const avgLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null

  return {
    fleet: {
      total: rows.length,
      running: rows.filter((r) => r.status === "running").length,
      incidents24h,
      avgLatencyMs,
    },
    agents: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      deploymentTarget: r.deploymentTarget,
      runtime: r.runtime,
      kumaStatus: r.kumaStatus,
      uptimeRatio24h: r.kumaUptimeRatio,
      latencyMs: r.kumaResponseTimeMs,
      certDaysRemaining: r.kumaCertDaysRemaining,
      lastCheckAt: r.kumaCheckedAt ? r.kumaCheckedAt.toISOString() : null,
      costUsd: r.openRouterUsageUsd ?? 0,
      runs24h: runs.get(r.id) ?? 0,
      lastEventAt: r.lastEventAt ? r.lastEventAt.toISOString() : null,
    })),
  }
}
