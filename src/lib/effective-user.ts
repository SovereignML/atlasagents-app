import { auth } from "@/auth"
import { getImpersonatedUserId } from "@/lib/impersonation"
import { isUserInTenantScopeOf } from "@/lib/tenant"

/**
 * The impersonated user id, but ONLY when the current user is allowed to
 * impersonate them right now:
 *   - platform staff (role === "admin") may impersonate anyone, or
 *   - a tenant admin may impersonate a user who is currently a member of one of
 *     their child end-customer teams.
 * Returns null otherwise. The scope is re-checked here on every request because
 * the impersonation cookie carries only a userId (defense-in-depth).
 */
export async function getHonoredImpersonatedUserId(): Promise<string | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const impersonatedId = await getImpersonatedUserId()
  if (!impersonatedId || impersonatedId === session.user.id) return null

  const isAdmin = (session.user as { role?: string }).role === "admin"
  if (isAdmin) return impersonatedId

  if (await isUserInTenantScopeOf(session.user.id, impersonatedId)) {
    return impersonatedId
  }
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
