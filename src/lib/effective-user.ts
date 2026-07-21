import { auth } from "@/auth"
import { getImpersonationCookie } from "@/lib/impersonation"
import { getTeam, isUserInTenantScopeOf, isTenantManagerOverChild } from "@/lib/tenant"
import { getUserTeam } from "@/lib/team"

/**
 * The impersonated user id, but ONLY when the current user is allowed to
 * impersonate them right now:
 *   - platform staff (role === "admin") may impersonate anyone;
 *   - "act as customer" (cookie carries a child team `t`): honored only for a
 *     tenant manager (owner/admin) of that child's white-label tenant, and only
 *     when the pinned user is that child team's actual owner;
 *   - legacy single-user impersonation (no `t`): a tenant admin may impersonate a
 *     user who is a member of one of their child end-customer teams.
 * Returns null otherwise. Re-checked on every request because the cookie carries
 * only ids (defense-in-depth).
 */
export async function getHonoredImpersonatedUserId(): Promise<string | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const cookie = await getImpersonationCookie()
  if (!cookie || cookie.u === session.user.id) return null

  const isAdmin = (session.user as { role?: string }).role === "admin"

  // Act-as-team.
  if (cookie.t) {
    if (isAdmin) return cookie.u
    // The pinned user must be the child team's real owner (prevents pinning an
    // arbitrary — possibly higher-privileged — user as the effective identity).
    const child = await getTeam(cookie.t)
    if (!child || child.ownerId !== cookie.u) return null
    if (await isTenantManagerOverChild(session.user.id, cookie.t)) return cookie.u
    return null
  }

  // Legacy single-user impersonation.
  if (isAdmin) return cookie.u
  if (await isUserInTenantScopeOf(session.user.id, cookie.u)) return cookie.u
  return null
}

/**
 * Returns the user ID whose data should be displayed. When an admin or tenant
 * admin is impersonating an in-scope user, returns the impersonated user's ID.
 * Otherwise returns the session user's own ID. Null if not authenticated.
 */
export async function getEffectiveUserId(): Promise<string | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  const impersonatedId = await getHonoredImpersonatedUserId()
  return impersonatedId ?? session.user.id
}

export type EffectiveTeamContext = {
  /** The team all team-scoped work should target. */
  teamId: string
  /** The effective user's role in that team ("owner" when acting-as-team). */
  role: string
  /** The user id that OWNS created rows / funds resources. */
  effectiveUserId: string
  /** The REAL signed-in user — who audit trails must attribute actions to. */
  actorUserId: string
  /** True when the actor is operating inside a child team via "act as customer". */
  actingAsTeam: boolean
}

/**
 * The team context for the current request, honoring "act as customer". When a
 * tenant admin is acting as a child team, the team is PINNED to that child (not
 * the child owner's mutable `activeTeamId`) and the effective user is the child
 * owner — so the whole user-keyed dashboard + per-instance stack resolves to the
 * child team, while `actorUserId` stays the real tenant admin for audit. Falls
 * back to the effective user's active team otherwise. Null if unauthenticated or
 * no team resolves.
 */
export async function getEffectiveTeam(): Promise<EffectiveTeamContext | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const cookie = await getImpersonationCookie()
  if (cookie?.t) {
    const honored = await getHonoredImpersonatedUserId()
    if (honored && honored === cookie.u) {
      return {
        teamId: cookie.t,
        role: "owner",
        effectiveUserId: cookie.u,
        actorUserId: session.user.id,
        actingAsTeam: true,
      }
    }
  }

  const effectiveUserId = (await getHonoredImpersonatedUserId()) ?? session.user.id
  const team = await getUserTeam(effectiveUserId)
  if (!team) return null
  return {
    teamId: team.teamId,
    role: team.role,
    effectiveUserId,
    actorUserId: session.user.id,
    actingAsTeam: false,
  }
}
