// Integration tests for the claim/release idempotency primitive against a REAL
// postgres database (its INSERT … ON CONFLICT DO NOTHING RETURNING atomicity
// cannot be exercised without a live DB). See src/lib/idempotency.ts.
//
// Import order matters: `./db-env` redirects DATABASE_URL at the test DB, and
// MUST precede any import that reaches `@/db`.
import "./db-env"

import { beforeEach, describe, expect, it } from "vitest"
import { claimEvent, claimEventOn, releaseEvent } from "@/lib/idempotency"
import { db, processedEvents, sql } from "@/db"

async function claimCount(): Promise<number> {
  const rows = await db.select().from(processedEvents)
  return rows.length
}

describe("idempotency (DB-backed)", () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE "ProcessedEvent"`)
  })

  it("claims an event exactly once: first true, second false", async () => {
    expect(await claimEvent("t", "e1")).toBe(true)
    expect(await claimEvent("t", "e1")).toBe(false)
    expect(await claimCount()).toBe(1)
  })

  it("releaseEvent re-opens the claim so a later claimEvent succeeds", async () => {
    expect(await claimEvent("t", "e1")).toBe(true)
    await releaseEvent("t", "e1")
    expect(await claimCount()).toBe(0)
    // After release, the same key can be claimed again (Stripe-retry model).
    expect(await claimEvent("t", "e1")).toBe(true)
  })

  it("is race-safe: 10 concurrent claims of the same key yield exactly one true", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => claimEvent("t", "same")),
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await claimCount()).toBe(1)
  })

  it("claimEventOn is atomic: a throwing transaction does not persist the claim", async () => {
    // This is the property daily-billing relies on — the claim and the work it
    // guards commit together or roll back together.
    await expect(
      db.transaction(async (tx) => {
        const claimed = await claimEventOn(tx, "t", "e-rollback")
        expect(claimed).toBe(true)
        throw new Error("boom — simulated handler failure after claim")
      }),
    ).rejects.toThrow("boom")

    // The rollback must have undone the claim, so it is claimable again.
    expect(await claimCount()).toBe(0)
    expect(await claimEvent("t", "e-rollback")).toBe(true)
  })

  it("distinct sources with the same eventId do not collide", async () => {
    expect(await claimEvent("a", "x")).toBe(true)
    expect(await claimEvent("b", "x")).toBe(true)
    expect(await claimCount()).toBe(2)
  })
})
