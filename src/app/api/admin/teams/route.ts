import { NextResponse } from "next/server"
import type { SQL } from "drizzle-orm"
import { auth } from "@/auth"
import {
  db,
  teams,
  users,
  memberships,
  instances,
  subscriptions,
  plans,
  eq,
  and,
  or,
  desc,
  ilike,
  sql,
  inArray,
} from "@/db"

/**
 * GET /api/admin/teams
 *
 * Platform-admin team list backing /admin/teams. Supports a free-text `search`
 * (team name / owner name / owner email) and an exact `teamId` filter (used by
 * the deep-link from the Users page). Capped at 500 newest-first, mirroring the
 * users route. Each row carries the owner, member/agent counts, and whether the
 * owner currently holds an active enterprise subscription (shown as a badge —
 * the white-label toggle itself is `whiteLabelEnabled`, independent of plan).
 */
export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search")?.trim() || ""
    const teamId = searchParams.get("teamId")?.trim() || ""

    const conditions: SQL[] = []
    if (teamId) {
      conditions.push(eq(teams.id, teamId))
    }
    if (search) {
      const pattern = `%${search}%`
      const cond = or(
        ilike(teams.name, pattern),
        ilike(users.name, pattern),
        ilike(users.email, pattern),
      )
      if (cond) conditions.push(cond)
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const HARD_LIMIT = 500
    const requestedLimit = Math.min(
      Number(searchParams.get("limit") || HARD_LIMIT),
      HARD_LIMIT,
    )

    // Join owner so we can search by owner name/email and return owner details.
    const rows = await db
      .select({
        id: teams.id,
        name: teams.name,
        whiteLabelEnabled: teams.whiteLabelEnabled,
        seatLimit: teams.seatLimit,
        agentLimit: teams.agentLimit,
        parentTeamId: teams.parentTeamId,
        suspendedAt: teams.suspendedAt,
        createdAt: teams.createdAt,
        ownerId: users.id,
        ownerName: users.name,
        ownerEmail: users.email,
      })
      .from(teams)
      .innerJoin(users, eq(teams.ownerId, users.id))
      .where(where)
      .orderBy(desc(teams.createdAt))
      .limit(requestedLimit)

    const teamIds = rows.map((r) => r.id)
    const ownerIds = rows.map((r) => r.ownerId)

    const countExpr = sql<number>`count(*)::int`
    const [memberCounts, agentCounts, entSubs] =
      teamIds.length === 0
        ? [[], [], []]
        : await Promise.all([
            db
              .select({ teamId: memberships.teamId, count: countExpr })
              .from(memberships)
              .where(inArray(memberships.teamId, teamIds))
              .groupBy(memberships.teamId),
            db
              .select({ teamId: instances.teamId, count: countExpr })
              .from(instances)
              .where(inArray(instances.teamId, teamIds))
              .groupBy(instances.teamId),
            // Owners with an active/trialing enterprise subscription — drives the
            // "Enterprise" badge (informational; not the entitlement gate).
            db
              .selectDistinct({ userId: subscriptions.userId })
              .from(subscriptions)
              .innerJoin(plans, eq(plans.id, subscriptions.planId))
              .where(
                and(
                  inArray(subscriptions.userId, ownerIds),
                  inArray(subscriptions.status, ["active", "trialing"]),
                  eq(plans.tier, "enterprise"),
                ),
              ),
          ])

    const memberMap = new Map(memberCounts.map((r) => [r.teamId, r.count]))
    const agentMap = new Map(
      agentCounts.map((r) => [r.teamId as string, r.count]),
    )
    const entSet = new Set(entSubs.map((r) => r.userId))

    const result = rows.map((t) => ({
      id: t.id,
      name: t.name,
      whiteLabelEnabled: t.whiteLabelEnabled,
      seatLimit: t.seatLimit,
      agentLimit: t.agentLimit,
      parentTeamId: t.parentTeamId,
      suspendedAt: t.suspendedAt,
      createdAt: t.createdAt,
      owner: { id: t.ownerId, name: t.ownerName, email: t.ownerEmail },
      hasEnterpriseSub: entSet.has(t.ownerId),
      _count: {
        members: memberMap.get(t.id) ?? 0,
        agents: agentMap.get(t.id) ?? 0,
      },
    }))

    return NextResponse.json(result)
  } catch (error) {
    console.error("Failed to fetch teams:", error)
    return NextResponse.json(
      { error: "Failed to fetch teams" },
      { status: 500 },
    )
  }
}
