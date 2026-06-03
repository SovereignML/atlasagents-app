// Access guard for the reseller "tenant admin" panel. A tenant admin is an
// owner/admin of an ENTERPRISE-entitled team (white-label is enterprise-only).
// The panel lets them run their reseller business: manage child end-customer
// teams, view their agents, configure branding/Chatwoot, and answer support.
//
// This is distinct from the platform `role === "admin"` staff panel. Every
// tenant-admin page and API route must call requireTenantAdmin() — there is no
// layout-level gate.

import { auth } from "@/auth"
import { getUserTeam, canManageTeam } from "@/lib/team"
import { teamHasWhiteLabel } from "@/lib/white-label"
import { isChildOf } from "@/lib/tenant"

export type TenantAdmin = { userId: string; tenantTeamId: string }
export type TenantGuardError = { error: string; status: 401 | 403 | 404 }

export function isTenantGuardError(
  v: TenantAdmin | TenantGuardError,
): v is TenantGuardError {
  return "error" in v
}

/**
 * Resolve the caller as a tenant admin (owner/admin of an enterprise team), or
 * a typed error the caller maps to an HTTP status. The active team IS the
 * tenant team — child end-customers live under it via parentTeamId.
 */
export async function requireTenantAdmin(): Promise<TenantAdmin | TenantGuardError> {
  const session = await auth()
  if (!session?.user?.id) return { error: "Unauthorized", status: 401 }

  const ctx = await getUserTeam(session.user.id)
  if (!ctx) return { error: "No team", status: 404 }
  if (!canManageTeam(ctx.role)) return { error: "Forbidden", status: 403 }
  if (!(await teamHasWhiteLabel(ctx.teamId))) {
    return { error: "The reseller panel requires an Enterprise plan", status: 403 }
  }

  return { userId: session.user.id, tenantTeamId: ctx.teamId }
}

/** requireTenantAdmin + the child team must belong to this tenant. */
export async function requireTenantAdminOverChild(
  childTeamId: string,
): Promise<TenantAdmin | TenantGuardError> {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) return admin
  if (!(await isChildOf(childTeamId, admin.tenantTeamId))) {
    return { error: "Forbidden", status: 403 }
  }
  return admin
}
