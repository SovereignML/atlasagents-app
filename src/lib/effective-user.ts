import { auth } from "@/auth"
import { getImpersonatedUserId } from "@/lib/impersonation"

/**
 * Returns the user ID whose data should be displayed. When an admin is
 * impersonating another user, returns the impersonated user's ID.
 * Otherwise returns the session user's own ID.
 *
 * Returns null if the user is not authenticated.
 */
export async function getEffectiveUserId(): Promise<string | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const isAdmin = (session.user as { role?: string }).role === "admin"
  if (isAdmin) {
    const impersonatedId = await getImpersonatedUserId()
    if (impersonatedId) return impersonatedId
  }

  return session.user.id
}
