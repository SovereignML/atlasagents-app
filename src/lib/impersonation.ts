import { cookies } from "next/headers"

const COOKIE_NAME = "sovereign_impersonate"

/**
 * Set the impersonation cookie. Only admins should call this.
 * The cookie stores the target userId; the admin's real identity
 * stays in the JWT.
 */
export async function startImpersonation(targetUserId: string) {
  const jar = await cookies()
  jar.set(COOKIE_NAME, targetUserId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60, // 1 hour max
  })
}

export async function stopImpersonation() {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
}

/** Read the impersonated user ID from the cookie, or null. */
export async function getImpersonatedUserId(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(COOKIE_NAME)?.value ?? null
}
