import { db, users, eq } from "@/db"

/**
 * A signed-in user's current standing, re-read from the database while their
 * session is alive. Sessions are JWTs, so without this a ban or a role change
 * only took effect at the next sign-in: the old token kept working until it
 * expired.
 *
 * Read on every `auth()` call (the jwt callback in src/auth.ts), so results
 * are cached briefly. The cache lives on globalThis because the proxy and the
 * route handlers are separate bundles in one process; the admin user route
 * calls forgetAccountStatus() after a change so the ban lands on the next
 * request rather than within CACHE_MS.
 */
export type AccountStatus =
  | { kind: "active"; role: string }
  | { kind: "banned" }
  | { kind: "missing" }

const CACHE_MS = 30_000

type Entry = { status: AccountStatus; at: number }
const g = globalThis as unknown as { __atlasAccountStatus?: Map<string, Entry> }
const cache = (g.__atlasAccountStatus ??= new Map<string, Entry>())

export async function getAccountStatus(userId: string): Promise<AccountStatus> {
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.status

  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { isBanned: true, role: true },
  })
  const status: AccountStatus = !row
    ? { kind: "missing" }
    : row.isBanned
      ? { kind: "banned" }
      : { kind: "active", role: row.role || "user" }
  cache.set(userId, { status, at: Date.now() })
  return status
}

/** Drop a cached status so the next request re-reads it (after a ban, unban or role change). */
export function forgetAccountStatus(userId: string): void {
  cache.delete(userId)
}
