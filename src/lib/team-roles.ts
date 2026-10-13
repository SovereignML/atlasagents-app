// Team roles and what each may do. Pure, so it can be unit-tested and imported
// without the database; src/lib/team.ts re-exports all of it.

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

/**
 * Deploying provisions billable servers, so it takes at least the developer
 * role: viewers can look at a team's agents but not spend its money.
 */
export function canDeploy(role: string | null | undefined): boolean {
  if (!role || !(ROLES as readonly string[]).includes(role)) return false
  return rankRole(role as TeamRole) >= RANK.developer
}

export const DEPLOY_ROLE_DENIED =
  "Your role on this team can't deploy agents. Ask a team owner or admin for the developer role."
