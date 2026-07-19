import { db, subscriptions, teams, instances, eq, and, ne, inArray, sql } from "@/db"
import { seatsForTier, type PlanTier } from "@/configs/plans"

export { seatsForTier }

/**
 * Effective member cap for a team.
 *
 * An explicit `seatLimit` override wins (a platform-admin support cap, or a
 * reseller tenant's child cap). Otherwise the cap is derived from the max seats
 * across the owner's active/trialing subscriptions — a user holding multiple
 * subs gets the most generous cap — defaulting to Free (1) when none exist.
 * Enterprise resolves to `Infinity`.
 */
export async function getTeamSeatLimit(team: {
  seatLimit: number | null
  ownerId: string
}): Promise<number> {
  if (team.seatLimit != null) return team.seatLimit

  const subs = await db.query.subscriptions.findMany({
    where: and(
      eq(subscriptions.userId, team.ownerId),
      inArray(subscriptions.status, ["active", "trialing"]),
    ),
    columns: {},
    with: { plan: { columns: { tier: true } } },
  })

  const seats = subs
    .map((s) => s.plan?.tier as PlanTier | undefined)
    .filter((t): t is PlanTier => Boolean(t))
    .map(seatsForTier)

  return seats.length ? Math.max(...seats) : seatsForTier("free")
}

/**
 * Explicit per-team live-agent cap, or `null` when uncapped. Unlike seats there
 * is no tier-derived default — `teams.agentLimit` is an admin / reseller-tenant
 * override on the team row (a tenant caps how many agents a child customer may
 * run). Enforced at the deploy choke point (`createInstanceFromAgentFields`).
 */
export async function getTeamAgentLimit(teamId: string): Promise<number | null> {
  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    columns: { agentLimit: true },
  })
  return team?.agentLimit ?? null
}

/** Count of live (non-deleted) agents owned by a team. */
export async function countTeamAgents(teamId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(instances)
    .where(and(eq(instances.teamId, teamId), ne(instances.status, "deleted")))
  return row?.count ?? 0
}
