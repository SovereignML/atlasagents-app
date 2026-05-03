import { db, teams, memberships, users, eq, and } from "@/db"
import { createId } from "@paralleldrive/cuid2"

export const ROLES = ["owner", "admin", "developer", "viewer"] as const
export type TeamRole = (typeof ROLES)[number]

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
