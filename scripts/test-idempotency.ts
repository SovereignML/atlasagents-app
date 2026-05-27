// Smoke test for src/lib/idempotency.ts.
//
// Verifies: same (source, eventId) claim returns true once, false on
// re-attempts; release allows re-claim; concurrent claims race-safely.

import { claimEvent, releaseEvent } from "@/lib/idempotency"
import { db, processedEvents, and, eq } from "@/db"

async function main() {
  const fail: string[] = []
  const SRC = "test"
  const ID = `idempotency-smoke-${Date.now()}`

  // 1) First claim succeeds.
  const first = await claimEvent(SRC, ID, { hello: "world" })
  if (!first) fail.push("first claim should return true")

  // 2) Second claim is a no-op.
  const second = await claimEvent(SRC, ID)
  if (second) fail.push("second claim should return false (dedup)")

  // 3) Release lets a new claim succeed.
  await releaseEvent(SRC, ID)
  const third = await claimEvent(SRC, ID)
  if (!third) fail.push("post-release claim should return true")

  // 4) Concurrent claims: only one wins.
  const RACE_ID = `idempotency-race-${Date.now()}`
  const racers = await Promise.all(
    Array.from({ length: 10 }, () => claimEvent(SRC, RACE_ID)),
  )
  const winners = racers.filter((r) => r).length
  if (winners !== 1) fail.push(`expected exactly 1 race winner, got ${winners}`)

  // Cleanup
  await db.delete(processedEvents).where(and(eq(processedEvents.source, SRC), eq(processedEvents.eventId, ID)))
  await db.delete(processedEvents).where(and(eq(processedEvents.source, SRC), eq(processedEvents.eventId, RACE_ID)))

  if (fail.length === 0) {
    console.log("✅ PASS — idempotency primitive correct under concurrency")
  } else {
    console.error("❌ FAIL:", fail.join("; "))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
