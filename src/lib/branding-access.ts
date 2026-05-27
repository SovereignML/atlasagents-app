// Shared access guard for white-label branding routes. Requires an
// authenticated owner/admin of a team that is currently entitled (active
// scale/enterprise subscription). Also resolves the team owner's id, which
// keys domain-ownership verification (so the row is stable regardless of which
// admin initiates it).

import { auth } from "@/auth"
import { db, eq, teams } from "@/db"
import { getUserTeam, canManageTeam } from "@/lib/team"
import { teamHasWhiteLabel } from "@/lib/white-label"

export type BrandingManager = { userId: string; teamId: string; ownerId: string }
export type BrandingGuardError = { error: string; status: 401 | 403 | 404 }

export async function requireBrandingManager(): Promise<
  BrandingManager | BrandingGuardError
> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized", status: 401 }

  const ctx = await getUserTeam(session.user.id)
  if (!ctx) return { error: "No team", status: 404 }
  if (!canManageTeam(ctx.role)) return { error: "Forbidden", status: 403 }
  if (!(await teamHasWhiteLabel(ctx.teamId))) {
    return { error: "White-label is not available on your plan", status: 403 }
  }

  const team = await db.query.teams.findFirst({
    where: eq(teams.id, ctx.teamId),
    columns: { ownerId: true },
  })
  if (!team) return { error: "Team not found", status: 404 }

  return { userId: session.user.id, teamId: ctx.teamId, ownerId: team.ownerId }
}
