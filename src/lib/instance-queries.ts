import {
  and,
  or,
  eq,
  inArray,
  notInArray,
  db,
  instances,
  teams,
  memberships,
  instanceAccess,
} from "@/db"
import { alias } from "drizzle-orm/pg-core"

/**
 * An agent is visible to a user if ANY of:
 *  - they created it (`instances.userId`)
 *  - they own the agent's team (team-owner god-view)
 *  - they hold a per-agent access grant (`InstanceAccess`)
 *  - they own the agent's team's PARENT (reseller tenant god-view over every
 *    child end-customer's agents)
 * Uses uncorrelated subqueries so these stay synchronous predicate builders
 * usable directly inside `.where(...)`. Visibility ⊇ all grant levels — every
 * MUTATING route must additionally gate on level (see src/lib/instance-access.ts).
 */
function visibleToUser(userId: string) {
  const parentTeams = alias(teams, "wl_parent")
  return or(
    eq(instances.userId, userId),
    inArray(
      instances.teamId,
      db.select({ id: teams.id }).from(teams).where(eq(teams.ownerId, userId)),
    ),
    inArray(
      instances.id,
      db
        .select({ id: instanceAccess.instanceId })
        .from(instanceAccess)
        .where(eq(instanceAccess.userId, userId)),
    ),
    // Reseller tenant god-view: child teams whose parent is a white-label team
    // the user OWNS OR ADMINS. Membership-based (not owner-only) so a non-owner
    // tenant admin — whom requireTenantAdmin already admits — gets the same view.
    inArray(
      instances.teamId,
      db
        .select({ id: teams.id })
        .from(teams)
        .where(
          inArray(
            teams.parentTeamId,
            db
              .select({ id: parentTeams.id })
              .from(memberships)
              .innerJoin(parentTeams, eq(parentTeams.id, memberships.teamId))
              .where(
                and(
                  eq(memberships.userId, userId),
                  inArray(memberships.role, ["owner", "admin"]),
                  eq(parentTeams.whiteLabelEnabled, true),
                ),
              ),
          ),
        ),
    ),
  )
}

/** User-facing lists and lookups: never surface soft-deleted rows */
export function whereUserInstancesVisible(userId: string) {
  return and(visibleToUser(userId), notInArray(instances.status, ["deleted"]))
}

export function whereUserInstanceVisible(userId: string, instanceId: string) {
  return and(
    eq(instances.id, instanceId),
    visibleToUser(userId),
    notInArray(instances.status, ["deleted"]),
  )
}
