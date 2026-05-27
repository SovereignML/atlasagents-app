// Claim/release primitive backed by the `ProcessedEvent` table.
//
// Purpose: dedupe at-least-once event sources (Stripe webhooks, daily
// billing cron) without dropping work on failure.
//
// Usage pattern (claim-with-release, NOT claim-on-success):
//
//   const claimed = await claimEvent("stripe", event.id, event)
//   if (!claimed) return /* already processed — 200 OK */
//   try {
//     await doWork()
//   } catch (err) {
//     await releaseEvent("stripe", event.id)  // let the upstream retry
//     throw err
//   }
//
// Why release on error: Stripe retries 5xx responses. If we claim-and-
// never-release, a transient handler failure becomes permanent dropped
// work. Release-on-error makes the system at-least-once with idempotency,
// which matches Stripe's delivery model.

import { db, processedEvents, and, eq } from "@/db"

/** A Drizzle transaction handle, or the top-level `db` — both expose `.insert`. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Atomic claim, on a caller-supplied executor (transaction or `db`). Returns
 * `true` if WE just claimed the event; `false` if it was already claimed.
 *
 * Pass a transaction handle to make the claim commit ATOMICALLY with the work
 * it guards — e.g. daily-billing claims `daily_billing:<day>:<instance>` in the
 * same tx as the wallet deduction, so the claim and the charge are inseparable:
 * neither a crash nor a retry can charge twice or strand an instance unbilled.
 */
export async function claimEventOn(
  exec: Executor,
  source: string,
  eventId: string,
  payload?: unknown,
): Promise<boolean> {
  const result = await exec
    .insert(processedEvents)
    .values({ source, eventId, payload: payload ?? null })
    .onConflictDoNothing()
    .returning({ source: processedEvents.source })
  return result.length > 0
}

/**
 * Atomic claim. Returns `true` if WE just claimed the event (caller
 * should proceed); `false` if it was already claimed (caller should
 * short-circuit as a no-op).
 *
 * The INSERT … ON CONFLICT DO NOTHING RETURNING pattern is atomic at
 * the row level — there is no read-then-write race.
 */
export async function claimEvent(
  source: string,
  eventId: string,
  payload?: unknown,
): Promise<boolean> {
  return claimEventOn(db, source, eventId, payload)
}

/**
 * Release a previously-claimed event so the upstream source can retry.
 * Call from a catch block when the handler fails — Stripe (or whoever)
 * will re-deliver, and the next attempt's `claimEvent` will succeed.
 */
export async function releaseEvent(source: string, eventId: string): Promise<void> {
  await db
    .delete(processedEvents)
    .where(and(eq(processedEvents.source, source), eq(processedEvents.eventId, eventId)))
}
