import {
  db,
  teams,
  memberships,
  users,
  instances,
  subscriptions,
  auditLogs,
  eq,
  and,
  ne,
  or,
  inArray,
  sql,
} from "@/db"
import { createId } from "@paralleldrive/cuid2"

export const ROLES = ["owner", "admin", "developer", "viewer"] as const
export type TeamRole = (typeof ROLES)[number]

/** Max teams a single user may own (excludes teams they were invited into). */
export const MAX_TEAMS_PER_USER = 5

const RANK: Record<TeamRole, number> = { owner: 4, admin: 3, developer: 2, viewer: 1 }

export function canManageTeam(role: TeamRole | null | undefined): boolean {
  return role === "owner" || role === "admin"
}

export function canAssignRole(actor: TeamRole, target: TeamRole): boolean {
  if (actor === "owner") return target !== "owner"
  if (actor === "admin") return target === "developer" || target === "viewer"
  return false
}

export function rankRole(role: TeamRole): number {
  return RANK[role]
}

export async function getOrCreatePersonalTeam(userId: string) {
  const existing = await db.query.teams.findFirst({
    where: eq(teams.ownerId, userId),
  })
  if (existing) return existing

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { name: true, email: true },
  })

  const teamName = user?.name ? `${user.name}'s Team` : (user?.email?.split("@")[0] ?? "Personal") + " Team"

  return await db.transaction(async (tx) => {
    const [team] = await tx
      .insert(teams)
      .values({ id: createId(), name: teamName, ownerId: userId })
      .returning()
    await tx
      .insert(memberships)
      .values({ teamId: team.id, userId, role: "owner" })
      .onConflictDoNothing()
    return team
  })
}

/**
 * Creates a brand-new team owned by `userId` (with the owner membership) and
 * returns it. Unlike `getOrCreatePersonalTeam`, this always inserts a fresh
 * team — used by the topbar "Create New Team" flow.
 *
 * Enforces `MAX_TEAMS_PER_USER` on the number of teams the user owns unless
 * `opts.bypassLimit` is set (platform staff). Throws `Error("TEAM_LIMIT")`
 * when the cap is reached.
 */
export async function createTeam(
  userId: string,
  name: string,
  opts?: { bypassLimit?: boolean },
) {
  return await db.transaction(async (tx) => {
    if (!opts?.bypassLimit) {
      // Serialize concurrent creates for this user so the count check + insert
      // is atomic (same approach as the seat-limit lock in /api/team/accept).
      await tx.execute(sql`SELECT 1 FROM "User" WHERE id = ${userId} FOR UPDATE`)
      const owned = await tx.query.teams.findMany({
        where: eq(teams.ownerId, userId),
      })
      if (owned.length >= MAX_TEAMS_PER_USER) {
        throw new Error("TEAM_LIMIT")
      }
    }
    const [team] = await tx
      .insert(teams)
      .values({ id: createId(), name, ownerId: userId })
      .returning()
    await tx
      .insert(memberships)
      .values({ teamId: team.id, userId, role: "owner" })
      .onConflictDoNothing()
    return team
  })
}

/**
 * Permanently deletes a team that is safe to remove. Owner-only and guarded so
 * we never orphan live infrastructure or customer orgs. Throws a typed
 * `Error(<code>)` the route maps to an HTTP status:
 *   NOT_FOUND | FORBIDDEN | LAST_TEAM | HAS_AGENTS | HAS_CHILDREN
 *
 * All guards run inside the transaction (behind the same per-user `FOR UPDATE`
 * lock `createTeam` uses) so a concurrent deploy / invite-accept can't race past
 * them. Most related rows FK-cascade on the `teams` delete; the two that don't
 * (`subscriptions.teamId` and `auditLogs.teamId`) are cleaned up here so nothing
 * dangles. Returns the deleted team's name for audit logging.
 */
export async function deleteTeam(userId: string, teamId: string): Promise<string> {
  return await db.transaction(async (tx) => {
    // Serialize against this user's concurrent create/delete (same lock as createTeam).
    await tx.execute(sql`SELECT 1 FROM "User" WHERE id = ${userId} FOR UPDATE`)

    const team = await tx.query.teams.findFirst({ where: eq(teams.id, teamId) })
    if (!team) throw new Error("NOT_FOUND")
    // Owner-only — stronger than canManageTeam (a team admin cannot delete).
    if (team.ownerId !== userId) throw new Error("FORBIDDEN")

    // Keep at least one owned team so the user always has a workspace (and we
    // avoid getUserTeam lazily recreating a personal team).
    const owned = await tx.query.teams.findMany({
      where: eq(teams.ownerId, userId),
      columns: { id: true },
    })
    if (owned.length <= 1) throw new Error("LAST_TEAM")

    // Block on any non-deleted agent — guarantees there's no live droplet to
    // tear down. Fully-deleted instance rows are fine (they cascade).
    const liveAgent = await tx.query.instances.findFirst({
      where: and(eq(instances.teamId, teamId), ne(instances.status, "deleted")),
      columns: { id: true },
    })
    if (liveAgent) throw new Error("HAS_AGENTS")

    // Block reseller parents with child end-customer orgs (they'd be orphaned).
    const child = await tx.query.teams.findFirst({
      where: eq(teams.parentTeamId, teamId),
      columns: { id: true },
    })
    if (child) throw new Error("HAS_CHILDREN")

    // No-residue cleanup for rows that don't FK-cascade.
    const instanceIds = (
      await tx.query.instances.findMany({
        where: eq(instances.teamId, teamId),
        columns: { id: true },
      })
    ).map((r) => r.id)
    await tx
      .delete(subscriptions)
      .where(
        instanceIds.length
          ? or(eq(subscriptions.teamId, teamId), inArray(subscriptions.instanceId, instanceIds))
          : eq(subscriptions.teamId, teamId),
      )
    await tx.delete(auditLogs).where(eq(auditLogs.teamId, teamId))

    // Cascade handles memberships, instances, invites, branding, providers,
    // ssh keys, backup records, tenant config.
    await tx.delete(teams).where(eq(teams.id, teamId))

    return team.name
  })
}

/**
 * Resolves the active team context for a user. Uses `activeTeamId` if set
 * and the user still has a valid membership; falls back to personal team.
 */
export async function getUserTeam(userId: string): Promise<{
  teamId: string
  role: TeamRole
} | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { activeTeamId: true },
  })

  if (user?.activeTeamId) {
    const m = await db.query.memberships.findFirst({
      where: and(eq(memberships.teamId, user.activeTeamId), eq(memberships.userId, userId)),
    })
    if (m) return { teamId: user.activeTeamId, role: m.role as TeamRole }
  }

  const team = await getOrCreatePersonalTeam(userId)
  const m = await db.query.memberships.findFirst({
    where: and(eq(memberships.teamId, team.id), eq(memberships.userId, userId)),
  })
  if (!m) return null
  return { teamId: team.id, role: m.role as TeamRole }
}

/**
 * Active team context, but only if the user can manage it (owner/admin).
 * Returns null otherwise — callers respond 403. Used to gate team-shared
 * provider mutations (connect/disconnect Drive & Cloudflare, SSH keys).
 */
export async function requireTeamManage(
  userId: string,
): Promise<{ teamId: string; role: TeamRole } | null> {
  const ctx = await getUserTeam(userId)
  if (!ctx || !canManageTeam(ctx.role)) return null
  return ctx
}

/** The user's role in a specific team (not necessarily the active one), or null. */
export async function getMembershipRole(
  userId: string,
  teamId: string,
): Promise<TeamRole | null> {
  const m = await db.query.memberships.findFirst({
    where: and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)),
  })
  return m ? (m.role as TeamRole) : null
}

/** Returns all teams the user is a member of (for the team switcher). */
export async function listUserTeams(userId: string) {
  const rows = await db.query.memberships.findMany({
    where: eq(memberships.userId, userId),
    with: { team: { columns: { id: true, name: true } } },
  })
  return rows.map((r) => ({ teamId: r.team.id, name: r.team.name, role: r.role as TeamRole }))
}

/** Switch the user's active team (validates membership). */
export async function switchTeam(userId: string, teamId: string): Promise<boolean> {
  const m = await db.query.memberships.findFirst({
    where: and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)),
  })
  if (!m) return false
  await db.update(users).set({ activeTeamId: teamId }).where(eq(users.id, userId))
  return true
}
