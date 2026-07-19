// Read-time health classification for the admin ops dashboard. There is no
// stored "health"/"churn" column — Healthy / At-Risk / Churn-Risk is computed
// from live signals (instance status, activity recency, uptime, subscription
// state). Snapshot only; no history. MRR is compute-plan revenue derived from
// serverConfig prices (mirrors src/app/admin/revenue/page.tsx), NOT Stripe
// subscription amounts.

import {
  db,
  instances,
  teams,
  users,
  memberships,
  subscriptions,
  plans,
  eq,
  and,
  ne,
  desc,
  inArray,
  sql,
} from "@/db"

export type HealthTier = "healthy" | "at_risk" | "churn_risk"
export type HealthCounts = Record<HealthTier, number>

const DAY_MS = 24 * 60 * 60 * 1000

function emptyCounts(): HealthCounts {
  return { healthy: 0, at_risk: 0, churn_risk: 0 }
}

function tally(rows: { tier: HealthTier }[]): HealthCounts {
  const c = emptyCounts()
  for (const r of rows) c[r.tier]++
  return c
}

/** Worst-of two tiers (churn_risk > at_risk > healthy). */
function worse(a: HealthTier, b: HealthTier): HealthTier {
  const rank: Record<HealthTier, number> = { healthy: 0, at_risk: 1, churn_risk: 2 }
  return rank[a] >= rank[b] ? a : b
}

/**
 * Classify a single instance. Priority: churn conditions first, then at-risk,
 * else healthy. Activity age uses lastActiveAt, falling back to createdAt so a
 * freshly-provisioned instance that has never been used isn't flagged churn.
 */
export function classifyInstanceHealth(i: {
  status: string
  lastActiveAt: Date | null
  createdAt: Date
  kumaStatus: string | null
  subStatus?: string | null
}): HealthTier {
  const ref = i.lastActiveAt ?? i.createdAt
  const idleMs = Date.now() - ref.getTime()

  // Churn risk
  if (i.status === "failed_provisioning" || i.status === "deleting") return "churn_risk"
  if (i.subStatus === "past_due") return "churn_risk" // payment actively failing
  if (idleMs > 30 * DAY_MS) return "churn_risk"

  // At risk
  if (i.status === "stopped") return "at_risk"
  if (i.kumaStatus === "down") return "at_risk"
  // Cancelled but still running (wallet fallback) — a real churn signal, but not
  // dead yet; flag as at-risk rather than churn while it keeps serving.
  if (i.subStatus === "canceled") return "at_risk"
  if (idleMs > 14 * DAY_MS) return "at_risk"

  // Healthy: running/provisioning/pending, fresh, uptime up-or-unknown.
  return "healthy"
}

export type FleetRow = {
  id: string
  name: string
  slug: string
  ownerEmail: string
  serverLabel: string
  runtime: string
  deploymentTarget: string
  regionCode: string | null
  status: string
  lastActiveAt: Date | null
  tier: HealthTier
}

/**
 * Fleet health for the dashboard: every non-deleted instance classified, plus
 * Healthy/At-Risk/Churn counts. Capped newest-first. Pass `teamIds` to scope to
 * a set of teams (the reseller tenant console passes its child team ids); omit
 * for the platform-wide admin view.
 */
export async function getFleetHealth(
  opts: { teamIds?: string[]; limit?: number } = {},
): Promise<{
  counts: HealthCounts
  rows: FleetRow[]
}> {
  const { teamIds, limit = 500 } = opts
  if (teamIds && teamIds.length === 0) return { counts: emptyCounts(), rows: [] }
  const list = await db.query.instances.findMany({
    where: teamIds
      ? and(ne(instances.status, "deleted"), inArray(instances.teamId, teamIds))
      : ne(instances.status, "deleted"),
    with: {
      user: { columns: { email: true } },
      serverConfig: { columns: { label: true } },
      region: { columns: { slug: true } },
      subscription: { columns: { status: true } },
    },
    orderBy: desc(instances.createdAt),
    limit,
  })

  const rows: FleetRow[] = list.map((i) => ({
    id: i.id,
    name: i.name,
    slug: i.slug,
    ownerEmail: i.user?.email ?? "-",
    serverLabel: i.serverConfig?.label ?? "-",
    runtime: i.runtime ?? "openclaw",
    deploymentTarget: i.deploymentTarget ?? "vps",
    regionCode: i.region?.slug ?? null,
    status: i.status,
    lastActiveAt: i.lastActiveAt,
    tier: classifyInstanceHealth({
      status: i.status,
      lastActiveAt: i.lastActiveAt,
      createdAt: i.createdAt,
      kumaStatus: i.kumaStatus,
      subStatus: i.subscription?.status ?? null,
    }),
  }))

  return { counts: tally(rows), rows }
}

export type AccountRow = {
  teamId: string
  name: string
  ownerEmail: string
  planTier: string | null
  agents: number
  members: number
  mrrUsd: number
  lastActiveAt: Date | null
  suspended: boolean
  tier: HealthTier
}

/**
 * Account (Team) health for the dashboard. Team tier = worst of its instances,
 * escalated to churn_risk when the team is suspended or its owner's
 * subscription is past_due/canceled. Teams with no agents are At-Risk (minimal
 * setup / no adoption). MRR = sum of compute-plan monthly-equivalent across the
 * team's running instances.
 */
export async function getAccountHealth(
  opts: { teamIds?: string[]; limit?: number } = {},
): Promise<{
  counts: HealthCounts
  rows: AccountRow[]
}> {
  const { teamIds: scopeTeamIds, limit = 500 } = opts
  if (scopeTeamIds && scopeTeamIds.length === 0) return { counts: emptyCounts(), rows: [] }
  const baseQuery = db
    .select({
      id: teams.id,
      name: teams.name,
      suspendedAt: teams.suspendedAt,
      ownerId: users.id,
      ownerEmail: users.email,
    })
    .from(teams)
    .innerJoin(users, eq(teams.ownerId, users.id))
  const teamRows = await (scopeTeamIds
    ? baseQuery.where(inArray(teams.id, scopeTeamIds))
    : baseQuery
  )
    .orderBy(desc(teams.createdAt))
    .limit(limit)

  if (teamRows.length === 0) return { counts: emptyCounts(), rows: [] }

  const teamIds = teamRows.map((r) => r.id)
  const ownerIds = teamRows.map((r) => r.ownerId)
  const countExpr = sql<number>`count(*)::int`

  const [inst, memberCounts, ownerSubs] = await Promise.all([
    db.query.instances.findMany({
      where: and(inArray(instances.teamId, teamIds), ne(instances.status, "deleted")),
      columns: {
        teamId: true,
        status: true,
        lastActiveAt: true,
        kumaStatus: true,
        createdAt: true,
        billingInterval: true,
      },
      with: {
        serverConfig: { columns: { priceMonthly: true, priceYearly: true } },
        subscription: { columns: { status: true } },
      },
    }),
    db
      .select({ teamId: memberships.teamId, count: countExpr })
      .from(memberships)
      .where(inArray(memberships.teamId, teamIds))
      .groupBy(memberships.teamId),
    // Owner's most-relevant subscription tier + status for the Plan column and
    // churn escalation. active/trialing/past_due/canceled all matter here.
    db
      .select({ userId: subscriptions.userId, tier: plans.tier, status: subscriptions.status })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(inArray(subscriptions.userId, ownerIds)),
  ])

  const memberMap = new Map(memberCounts.map((r) => [r.teamId, r.count]))

  // Fold instances per team.
  type Agg = { tier: HealthTier; mrr: number; lastActive: Date | null; count: number }
  const agg = new Map<string, Agg>()
  for (const i of inst) {
    if (!i.teamId) continue
    const a = agg.get(i.teamId) ?? { tier: "healthy", mrr: 0, lastActive: null, count: 0 }
    a.count++
    a.tier = worse(
      a.tier,
      classifyInstanceHealth({
        status: i.status,
        lastActiveAt: i.lastActiveAt,
        createdAt: i.createdAt,
        kumaStatus: i.kumaStatus,
        subStatus: i.subscription?.status ?? null,
      }),
    )
    if (i.status === "running" && i.serverConfig) {
      a.mrr +=
        i.billingInterval === "year"
          ? i.serverConfig.priceYearly / 12
          : i.serverConfig.priceMonthly
    }
    if (i.lastActiveAt && (!a.lastActive || i.lastActiveAt > a.lastActive)) {
      a.lastActive = i.lastActiveAt
    }
    agg.set(i.teamId, a)
  }

  // Owner subscription: prefer active/trialing tier for display; track payment
  // state for churn escalation. A `canceled` sub only signals churn when the
  // owner has NO active/trialing sub left — otherwise it's just normal history
  // (e.g. one deleted agent) and must not condemn a paying account.
  const planByOwner = new Map<string, string>()
  const activeOwner = new Set<string>()
  const pastDueOwner = new Set<string>()
  const canceledOwner = new Set<string>()
  for (const s of ownerSubs) {
    if (s.status === "active" || s.status === "trialing") {
      activeOwner.add(s.userId)
      if (!planByOwner.has(s.userId)) planByOwner.set(s.userId, s.tier)
    }
    if (s.status === "past_due") pastDueOwner.add(s.userId)
    if (s.status === "canceled") canceledOwner.add(s.userId)
  }

  const rows: AccountRow[] = teamRows.map((t) => {
    const a = agg.get(t.id)
    let tier: HealthTier = a ? a.tier : "at_risk" // no agents → minimal setup
    const lapsed = canceledOwner.has(t.ownerId) && !activeOwner.has(t.ownerId)
    if (pastDueOwner.has(t.ownerId) || lapsed) tier = "churn_risk"
    if (t.suspendedAt) tier = "churn_risk"
    return {
      teamId: t.id,
      name: t.name,
      ownerEmail: t.ownerEmail,
      planTier: planByOwner.get(t.ownerId) ?? null,
      agents: a?.count ?? 0,
      members: memberMap.get(t.id) ?? 0,
      mrrUsd: a?.mrr ?? 0,
      lastActiveAt: a?.lastActive ?? null,
      suspended: Boolean(t.suspendedAt),
      tier,
    }
  })

  return { counts: tally(rows), rows }
}
