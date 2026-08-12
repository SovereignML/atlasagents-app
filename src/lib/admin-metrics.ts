// Platform-wide growth / fleet / infrastructure metrics for the admin overview.
//
// Read-time only — there is no metrics rollup table, every number here is
// computed live from the operational tables. That is affordable because the
// admin console is staff-only and force-dynamic, but it means callers should
// fetch these in ONE Promise.all (see getAdminOverview) rather than per-card.
//
// Time buckets. Every timestamp column in the schema is `timestamp without
// time zone` written by `defaultNow()`, so bucketing against `now()` is
// self-consistent (both sit in the server's local zone). Day/month series use
// generate_series LEFT JOINed to the fact table so empty days appear as 0
// rather than vanishing — a gap-free x-axis is the whole point of a trend line.
//
// Companion: src/lib/admin-security.ts (security posture), src/lib/admin-accounts.ts
// (per-account/per-instance health classification).

import {
  db,
  instances,
  supportTickets,
  deletionRequests,
  sql,
  eq,
  ne,
} from "@/db"

export type DayPoint = { day: string; count: number }
export type MonthPoint = { month: string; count: number }
export type Slice = { key: string; count: number }

/** Percentage change, guarding the divide-by-zero the naive form hits on a cold start. */
function delta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null // null = "no baseline", not "0% growth"
  return ((current - previous) / previous) * 100
}

// ─────────────────────────────────────────────────────────────────────────────
// Growth
// ─────────────────────────────────────────────────────────────────────────────

export type SignupMetrics = {
  today: number
  last7: number
  prev7: number
  wowDelta: number | null
  last30: number
  prev30: number
  momDelta: number | null
  total: number
  daily: DayPoint[]
  monthly: MonthPoint[]
}

export async function getSignupMetrics(): Promise<SignupMetrics> {
  const [buckets, dailyRes, monthlyRes] = await Promise.all([
    // All the scalar windows in one pass over User — cheaper than five
    // round-trips, and they share the same `now()` so the windows can't skew
    // relative to each other mid-query.
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE "createdAt" >= now()::date)::int                              AS today,
        count(*) FILTER (WHERE "createdAt" >= now() - interval '7 days')::int                AS last7,
        count(*) FILTER (WHERE "createdAt" >= now() - interval '14 days'
                           AND "createdAt" <  now() - interval '7 days')::int                AS prev7,
        count(*) FILTER (WHERE "createdAt" >= now() - interval '30 days')::int               AS last30,
        count(*) FILTER (WHERE "createdAt" >= now() - interval '60 days'
                           AND "createdAt" <  now() - interval '30 days')::int               AS prev30,
        count(*)::int                                                                        AS total
      FROM "User"
    `),
    db.execute(sql`
      SELECT to_char(d, 'YYYY-MM-DD') AS day, count(u.id)::int AS count
      FROM generate_series(now()::date - interval '29 days', now()::date, interval '1 day') AS d
      LEFT JOIN "User" u ON u."createdAt" >= d AND u."createdAt" < d + interval '1 day'
      GROUP BY d ORDER BY d
    `),
    db.execute(sql`
      SELECT to_char(m, 'YYYY-MM') AS month, count(u.id)::int AS count
      FROM generate_series(
             date_trunc('month', now()) - interval '11 months',
             date_trunc('month', now()),
             interval '1 month'
           ) AS m
      LEFT JOIN "User" u ON u."createdAt" >= m AND u."createdAt" < m + interval '1 month'
      GROUP BY m ORDER BY m
    `),
  ])

  const b = (buckets.rows[0] ?? {}) as Record<string, number>
  const last7 = Number(b.last7 ?? 0)
  const prev7 = Number(b.prev7 ?? 0)
  const last30 = Number(b.last30 ?? 0)
  const prev30 = Number(b.prev30 ?? 0)

  return {
    today: Number(b.today ?? 0),
    last7,
    prev7,
    wowDelta: delta(last7, prev7),
    last30,
    prev30,
    momDelta: delta(last30, prev30),
    total: Number(b.total ?? 0),
    daily: dailyRes.rows as DayPoint[],
    monthly: monthlyRes.rows as MonthPoint[],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Activation funnel
// ─────────────────────────────────────────────────────────────────────────────

export type FunnelStage = { label: string; count: number; hint: string }

/**
 * Signup → verified → team → first agent → paying, as absolute user counts.
 *
 * Deliberately cumulative-but-independent: a user counts at "deployed" whether
 * or not they verified, so a stage that is WIDER than the one above it is a
 * real signal (e.g. OAuth users skip verification) rather than a bug. Read the
 * biggest drop, not the shape.
 */
export async function getActivationFunnel(): Promise<FunnelStage[]> {
  const res = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM "User")                                              AS signed_up,
      (SELECT count(*)::int FROM "User" WHERE "emailVerified" IS NOT NULL)            AS verified,
      (SELECT count(DISTINCT "ownerId")::int FROM "Team")                             AS has_team,
      (SELECT count(DISTINCT "userId")::int FROM "Instance"
        WHERE status <> 'deleted')                                                    AS deployed,
      (SELECT count(DISTINCT "userId")::int FROM "Subscription"
        WHERE status IN ('active','trialing'))                                        AS paying
  `)
  const r = (res.rows[0] ?? {}) as Record<string, number>
  return [
    { label: "Signed up", count: Number(r.signed_up ?? 0), hint: "all User rows" },
    { label: "Email verified", count: Number(r.verified ?? 0), hint: "emailVerified set (OAuth auto-verifies)" },
    { label: "Has a team", count: Number(r.has_team ?? 0), hint: "owns at least one Team" },
    { label: "Deployed an agent", count: Number(r.deployed ?? 0), hint: "owns a non-deleted Instance" },
    { label: "Paying", count: Number(r.paying ?? 0), hint: "active or trialing subscription" },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Agents / fleet
// ─────────────────────────────────────────────────────────────────────────────

export type AgentMetrics = {
  total: number
  running: number
  provisioning: number
  stopped: number
  failed: number
  byStatus: Slice[]
  byRuntime: Slice[]
  byTarget: Slice[]
  createdDaily: DayPoint[]
  activeLast24h: number
  failed7d: number
}

export async function getAgentMetrics(): Promise<AgentMetrics> {
  const [scalars, statusRes, runtimeRes, targetRes, dailyRes] = await Promise.all([
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE status <> 'deleted')::int                       AS total,
        count(*) FILTER (WHERE status = 'running')::int                        AS running,
        count(*) FILTER (WHERE status IN ('pending','provisioning'))::int      AS provisioning,
        count(*) FILTER (WHERE status = 'stopped')::int                        AS stopped,
        count(*) FILTER (WHERE status = 'failed_provisioning')::int            AS failed,
        count(*) FILTER (WHERE status <> 'deleted'
                          AND "lastActiveAt" >= now() - interval '24 hours')::int AS active_24h,
        count(*) FILTER (WHERE status = 'failed_provisioning'
                          AND "createdAt" >= now() - interval '7 days')::int   AS failed_7d
      FROM "Instance"
    `),
    db
      .select({ key: instances.status, count: sql<number>`count(*)::int` })
      .from(instances)
      .where(ne(instances.status, "deleted"))
      .groupBy(instances.status),
    db
      .select({
        key: sql<string>`coalesce(${instances.runtime}, 'openclaw')`,
        count: sql<number>`count(*)::int`,
      })
      .from(instances)
      .where(ne(instances.status, "deleted"))
      .groupBy(sql`coalesce(${instances.runtime}, 'openclaw')`),
    db
      .select({
        key: sql<string>`coalesce(${instances.deploymentTarget}, 'vps')`,
        count: sql<number>`count(*)::int`,
      })
      .from(instances)
      .where(ne(instances.status, "deleted"))
      .groupBy(sql`coalesce(${instances.deploymentTarget}, 'vps')`),
    db.execute(sql`
      SELECT to_char(d, 'YYYY-MM-DD') AS day, count(i.id)::int AS count
      FROM generate_series(now()::date - interval '29 days', now()::date, interval '1 day') AS d
      LEFT JOIN "Instance" i ON i."createdAt" >= d AND i."createdAt" < d + interval '1 day'
      GROUP BY d ORDER BY d
    `),
  ])

  const s = (scalars.rows[0] ?? {}) as Record<string, number>
  return {
    total: Number(s.total ?? 0),
    running: Number(s.running ?? 0),
    provisioning: Number(s.provisioning ?? 0),
    stopped: Number(s.stopped ?? 0),
    failed: Number(s.failed ?? 0),
    byStatus: statusRes as Slice[],
    byRuntime: runtimeRes as Slice[],
    byTarget: targetRes as Slice[],
    createdDaily: dailyRes.rows as DayPoint[],
    activeLast24h: Number(s.active_24h ?? 0),
    failed7d: Number(s.failed_7d ?? 0),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

export type ServerMetrics = {
  activeServers: number
  byRegion: Slice[]
  byPlan: Slice[]
  totalVcpu: number
  totalRamGb: number
}

/**
 * "Active server" = a live VM we are paying a provider for: a non-deleted
 * instance that has been handed a public IP. Counting `status = 'running'`
 * alone would undercount boxes mid-provision that already hold (and bill for)
 * a VM, which is exactly the cost blind spot this card exists to close.
 */
export async function getServerMetrics(): Promise<ServerMetrics> {
  const [scalars, regionRes, planRes] = await Promise.all([
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE status <> 'deleted' AND "ipAddress" IS NOT NULL)::int AS active_servers,
        coalesce(sum(sc.vcpu)  FILTER (WHERE i.status <> 'deleted' AND i."ipAddress" IS NOT NULL), 0)::int AS total_vcpu,
        coalesce(sum(sc."ramGb") FILTER (WHERE i.status <> 'deleted' AND i."ipAddress" IS NOT NULL), 0)::int AS total_ram
      FROM "Instance" i
      LEFT JOIN "ServerConfig" sc ON sc.id = i."serverConfigId"
    `),
    db.execute(sql`
      SELECT coalesce(r.slug, 'unknown') AS key, count(*)::int AS count
      FROM "Instance" i
      LEFT JOIN "Region" r ON r.id = i."regionId"
      WHERE i.status <> 'deleted' AND i."ipAddress" IS NOT NULL
      GROUP BY r.slug ORDER BY count DESC
    `),
    db.execute(sql`
      SELECT coalesce(sc.label, 'unknown') AS key, count(*)::int AS count
      FROM "Instance" i
      LEFT JOIN "ServerConfig" sc ON sc.id = i."serverConfigId"
      WHERE i.status <> 'deleted' AND i."ipAddress" IS NOT NULL
      GROUP BY sc.label ORDER BY count DESC
    `),
  ])

  const s = (scalars.rows[0] ?? {}) as Record<string, number>
  return {
    activeServers: Number(s.active_servers ?? 0),
    byRegion: regionRes.rows as Slice[],
    byPlan: planRes.rows as Slice[],
    totalVcpu: Number(s.total_vcpu ?? 0),
    totalRamGb: Number(s.total_ram ?? 0),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue / commercial
// ─────────────────────────────────────────────────────────────────────────────

export type RevenueMetrics = {
  mrrUsd: number
  activeSubs: number
  trialingSubs: number
  pastDueSubs: number
  canceledSubs: number
  arpaUsd: number
}

/**
 * MRR is compute-plan revenue derived from ServerConfig prices on RUNNING
 * instances — the same basis as /admin/revenue and admin-accounts.ts, NOT
 * Stripe subscription amounts. Keep the three in step if the basis changes.
 */
export async function getRevenueMetrics(): Promise<RevenueMetrics> {
  const [mrrRes, subRes] = await Promise.all([
    db.execute(sql`
      SELECT coalesce(sum(
        CASE WHEN i."billingInterval" = 'year'
             THEN sc."priceYearly" / 12.0
             ELSE sc."priceMonthly"
        END
      ), 0)::float8 AS mrr
      FROM "Instance" i
      JOIN "ServerConfig" sc ON sc.id = i."serverConfigId"
      WHERE i.status = 'running'
    `),
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE status = 'active')::int    AS active,
        count(*) FILTER (WHERE status = 'trialing')::int  AS trialing,
        count(*) FILTER (WHERE status = 'past_due')::int  AS past_due,
        count(*) FILTER (WHERE status = 'canceled')::int  AS canceled
      FROM "Subscription"
    `),
  ])

  const mrrUsd = Number((mrrRes.rows[0] as { mrr?: number } | undefined)?.mrr ?? 0)
  const s = (subRes.rows[0] ?? {}) as Record<string, number>
  const paying = Number(s.active ?? 0) + Number(s.trialing ?? 0)

  return {
    mrrUsd,
    activeSubs: Number(s.active ?? 0),
    trialingSubs: Number(s.trialing ?? 0),
    pastDueSubs: Number(s.past_due ?? 0),
    canceledSubs: Number(s.canceled ?? 0),
    arpaUsd: paying > 0 ? mrrUsd / paying : 0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Support / queue depth
// ─────────────────────────────────────────────────────────────────────────────

export type QueueMetrics = {
  openTickets: number
  urgentTickets: number
  pendingDeletions: number
}

export async function getQueueMetrics(): Promise<QueueMetrics> {
  const [ticketRes, deletionRes] = await Promise.all([
    db
      .select({
        open: sql<number>`count(*) FILTER (WHERE ${supportTickets.status} IN ('open','in_progress','pending'))::int`,
        urgent: sql<number>`count(*) FILTER (WHERE ${supportTickets.priority} = 'urgent' AND ${supportTickets.status} <> 'resolved')::int`,
      })
      .from(supportTickets),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(deletionRequests)
      .where(eq(deletionRequests.status, "pending")),
  ])

  return {
    openTickets: Number(ticketRes[0]?.open ?? 0),
    urgentTickets: Number(ticketRes[0]?.urgent ?? 0),
    pendingDeletions: Number(deletionRes[0]?.count ?? 0),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate
// ─────────────────────────────────────────────────────────────────────────────

export type AdminOverview = {
  signups: SignupMetrics
  funnel: FunnelStage[]
  agents: AgentMetrics
  servers: ServerMetrics
  revenue: RevenueMetrics
  queue: QueueMetrics
}

/**
 * One call for the whole overview tab. Each section degrades independently —
 * a single failing aggregate (a table not yet synced on a fresh deploy, say)
 * must not take the dashboard down, matching how the existing page already
 * treats warm-pool health.
 */
export async function getAdminOverview(): Promise<{
  overview: Partial<AdminOverview>
  failures: string[]
}> {
  const failures: string[] = []
  const guard = <T>(name: string, p: Promise<T>): Promise<T | undefined> =>
    p.catch((err) => {
      console.error(`[admin-metrics] ${name} failed:`, err)
      failures.push(name)
      return undefined
    })

  const [signups, funnel, agents, servers, revenue, queue] = await Promise.all([
    guard("signups", getSignupMetrics()),
    guard("funnel", getActivationFunnel()),
    guard("agents", getAgentMetrics()),
    guard("servers", getServerMetrics()),
    guard("revenue", getRevenueMetrics()),
    guard("queue", getQueueMetrics()),
  ])

  return {
    overview: { signups, funnel, agents, servers, revenue, queue },
    failures,
  }
}
