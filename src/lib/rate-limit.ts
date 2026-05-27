// Postgres-backed fixed-window rate limiter.
//
// Replaces a per-process in-memory Map that couldn't survive horizontal
// scaling — each Node replica had its own counter, multiplying the
// effective limit by the number of replicas.
//
// API unchanged from the in-memory version except `rateLimit()` is now
// async. Callers update with a one-character change: `if (!await rateLimit(...))`.
//
// Implementation: each request maps to a fixed window bucket
// `windowStart = floor(now / windowMs) * windowMs`. We atomically insert
// the bucket if absent or increment its counter, and read back the new
// count in one round-trip via INSERT … ON CONFLICT DO UPDATE … RETURNING.
//
// Cleanup: a janitor query runs on roughly 1 in 100 calls to purge buckets
// older than 24 hours. No background worker needed.

import { db, rateLimitBuckets, sql } from "@/db"

const JANITOR_SAMPLE_RATE = 0.01
const JANITOR_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Returns `true` if the request fits within `maxRequests` over the trailing
 * `windowMs`; `false` if the rate limit was exceeded.
 *
 * The fixed-window model has the usual edge-of-window burst behaviour (a
 * user can fire `2 * maxRequests` across a window boundary). This is the
 * same trade-off as the previous in-memory implementation; it's fine for
 * the registration / forgot-password / 2FA call sites that use it.
 */
export async function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<boolean> {
  const now = Date.now()
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs)

  // Best-effort janitor — failures are non-fatal.
  if (Math.random() < JANITOR_SAMPLE_RATE) {
    void db
      .execute(
        sql`DELETE FROM "RateLimitBucket" WHERE "windowStart" < ${new Date(now - JANITOR_MAX_AGE_MS)}`,
      )
      .catch(() => {})
  }

  const [row] = await db
    .insert(rateLimitBuckets)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
      set: { count: sql`${rateLimitBuckets.count} + 1` },
    })
    .returning({ count: rateLimitBuckets.count })

  return (row?.count ?? maxRequests + 1) <= maxRequests
}
