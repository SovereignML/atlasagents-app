// Read helpers for the reseller (tenant-admin) console. Everything is scoped to
// a tenant's CHILD end-customer teams (teams with parentTeamId = tenant). Pages
// call these to get the child-team id set, then reuse the shared admin helpers
// (getFleetHealth/getAccountHealth with a `teamIds` filter) and the instance
// god-view. Operations on a child's resources flow through "Manage as customer"
// (act-as-team) — the console itself is read/oversight-oriented.

import { db, and, inArray, eq, memberships } from "@/db"
import { listChildTeams } from "@/lib/tenant"

/** The child end-customer team ids under a tenant (for scoped IN-queries). */
export async function getTenantChildTeamIds(tenantTeamId: string): Promise<string[]> {
  const children = await listChildTeams(tenantTeamId)
  return children.map((c) => c.id)
}

/** Map of child team id → name, for labeling rows across the console. */
export async function getChildTeamNameMap(
  tenantTeamId: string,
): Promise<Map<string, string>> {
  const children = await listChildTeams(tenantTeamId)
  return new Map(children.map((c) => [c.id, c.name]))
}

/** Distinct user ids who are members of any of the tenant's child teams. */
export async function getChildMemberUserIds(tenantTeamId: string): Promise<string[]> {
  const childIds = await getTenantChildTeamIds(tenantTeamId)
  if (childIds.length === 0) return []
  const rows = await db
    .selectDistinct({ userId: memberships.userId })
    .from(memberships)
    .where(inArray(memberships.teamId, childIds))
  return rows.map((r) => r.userId)
}

/**
 * True when `userId` is a member of a child team under `tenantTeamId`. Use to
 * authorize per-user tenant-admin actions (e.g. sending a password reset to a
 * customer) so a tenant can only touch users inside its own customer base.
 */
export async function isChildMember(
  tenantTeamId: string,
  userId: string,
): Promise<boolean> {
  const childIds = await getTenantChildTeamIds(tenantTeamId)
  if (childIds.length === 0) return false
  const row = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), inArray(memberships.teamId, childIds)),
    columns: { userId: true },
  })
  return Boolean(row)
}
