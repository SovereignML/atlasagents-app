import { cookies } from "next/headers"

const COOKIE_NAME = "sovereign_impersonate"

/**
 * Impersonation cookie payload.
 *  - `u`: the effective user id (whose data is shown).
 *  - `t`: OPTIONAL child team id — present only for "act as customer" (act-as-
 *    team), where `u` is pinned to that child team's owner. Absent for ordinary
 *    single-user impersonation.
 * The cookie carries only ids; every read re-authorizes (see effective-user.ts).
 */
export type ImpersonationCookie = { u: string; t?: string }

async function setCookie(payload: ImpersonationCookie): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE_NAME, JSON.stringify(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60, // 1 hour max
  })
}

/**
 * Impersonate a single user (platform admin, or the legacy tenant-admin
 * user-impersonation flow). The admin's real identity stays in the JWT.
 */
export async function startImpersonation(targetUserId: string): Promise<void> {
  await setCookie({ u: targetUserId })
}

/**
 * "Act as customer": operate inside a child end-customer team. Pins both the
 * child team id and its owner as the effective user, so the entire user-keyed
 * dashboard + per-instance stack resolves to that team. Honor is re-checked on
 * every request via a tenant-manager scope check (see effective-user.ts).
 */
export async function startActAsTeam(args: {
  childTeamId: string
  childOwnerUserId: string
}): Promise<void> {
  await setCookie({ u: args.childOwnerUserId, t: args.childTeamId })
}

export async function stopImpersonation(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
}

/**
 * Parse the impersonation cookie. Dual-format for back-compat: a legacy bare
 * userId string is read as `{ u: <string> }`; the current format is JSON
 * `{ u, t? }`. Fails CLOSED (returns null) on any malformed value — never throws,
 * so a bad cookie degrades to "not impersonating" rather than breaking auth.
 */
export async function getImpersonationCookie(): Promise<ImpersonationCookie | null> {
  const jar = await cookies()
  const raw = jar.get(COOKIE_NAME)?.value
  if (!raw) return null

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as { u?: unknown }).u === "string"
      ) {
        const p = parsed as { u: string; t?: unknown }
        return { u: p.u, t: typeof p.t === "string" ? p.t : undefined }
      }
    } catch {
      // fall through to null
    }
    return null
  }

  // Legacy bare-string userId.
  return { u: raw }
}

/** Read the impersonated user ID from the cookie, or null. (Back-compat.) */
export async function getImpersonatedUserId(): Promise<string | null> {
  return (await getImpersonationCookie())?.u ?? null
}
