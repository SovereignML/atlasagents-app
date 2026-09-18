import { describe, expect, it } from "vitest"
import { decideRetryEligibility } from "./retry-eligibility"

const TTL = 20 * 60 * 1000 // mirrors reconciler PROVISIONING_TTL_MS
const NOW = new Date("2026-09-17T12:00:00Z").getTime()

function at(msAgo: number): Date {
  return new Date(NOW - msAgo)
}

describe("decideRetryEligibility()", () => {
  it("allows a clean failure and does not call it stalled", () => {
    const d = decideRetryEligibility({
      status: "failed_provisioning",
      lastTransitionAt: at(1_000),
      createdAt: at(60_000),
      ttlMs: TTL,
      now: NOW,
    })
    expect(d).toEqual({ ok: true, stalled: false })
  })

  // The regression this whole module exists for: an app restart mid-provision
  // left the row in `provisioning` forever and the endpoint refused to retry.
  it("allows a provisioning row that has outlived the TTL, flagged as stalled", () => {
    const d = decideRetryEligibility({
      status: "provisioning",
      lastTransitionAt: at(TTL + 1),
      createdAt: at(TTL + 60_000),
      ttlMs: TTL,
      now: NOW,
    })
    expect(d).toEqual({ ok: true, stalled: true })
  })

  it("refuses a provisioning row that is still within the TTL", () => {
    const d = decideRetryEligibility({
      status: "provisioning",
      lastTransitionAt: at(TTL - 1),
      createdAt: at(TTL + 60_000),
      ttlMs: TTL,
      now: NOW,
    })
    expect(d.ok).toBe(false)
    expect(d.ok === false && d.reason).toMatch(/still in progress/)
  })

  // Boundary: exactly at the TTL is still "in progress" — we require strictly
  // older, matching the reconciler's own comparison.
  it("treats exactly-at-TTL as still in progress", () => {
    const d = decideRetryEligibility({
      status: "provisioning",
      lastTransitionAt: at(TTL),
      createdAt: at(TTL),
      ttlMs: TTL,
      now: NOW,
    })
    expect(d.ok).toBe(false)
  })

  // lastTransitionAt is nullable on rows that predate the column; createdAt is
  // the fallback clock, otherwise such a row could never be judged stalled.
  it("falls back to createdAt when lastTransitionAt is null", () => {
    const stale = decideRetryEligibility({
      status: "provisioning",
      lastTransitionAt: null,
      createdAt: at(TTL + 1),
      ttlMs: TTL,
      now: NOW,
    })
    expect(stale).toEqual({ ok: true, stalled: true })

    const fresh = decideRetryEligibility({
      status: "provisioning",
      lastTransitionAt: null,
      createdAt: at(1_000),
      ttlMs: TTL,
      now: NOW,
    })
    expect(fresh.ok).toBe(false)
  })

  it.each(["running", "pending", "stopped", "deleting", "deleted", "failed"])(
    "refuses %s and names the state",
    (status) => {
      const d = decideRetryEligibility({
        status,
        lastTransitionAt: at(TTL * 10),
        createdAt: at(TTL * 10),
        ttlMs: TTL,
        now: NOW,
      })
      expect(d.ok).toBe(false)
      expect(d.ok === false && d.reason).toContain(status)
    },
  )

  // ── Lock-aware behaviour ───────────────────────────────────────────
  // The lock, not age, decides whether a `provisioning` row is dead.

  it("refuses retry while the provisioning lock is held, however old the row is", () => {
    // A BYOS Hermes install can legitimately outrun the TTL. Retrying it
    // underneath itself would tear down a working deploy.
    const d = decideRetryEligibility({
      status: "provisioning",
      lastTransitionAt: at(TTL * 5),
      createdAt: at(TTL * 5),
      ttlMs: TTL,
      lockHeld: true,
      now: NOW,
    })
    expect(d.ok).toBe(false)
  })

  it("allows retry well before the TTL when no lock is held", () => {
    const d = decideRetryEligibility({
      status: "provisioning",
      lastTransitionAt: at(5 * 60 * 1000),
      createdAt: at(5 * 60 * 1000),
      ttlMs: TTL,
      lockHeld: false,
      now: NOW,
    })
    expect(d).toEqual({ ok: true, stalled: true })
  })

  it("does not retry a provision that just started and has not locked yet", () => {
    const d = decideRetryEligibility({
      status: "provisioning",
      lastTransitionAt: at(5_000),
      createdAt: at(5_000),
      ttlMs: TTL,
      lockHeld: false,
      now: NOW,
    })
    expect(d.ok).toBe(false)
  })

  it("falls back to the TTL when the lock state is unknown", () => {
    const probe = {
      status: "provisioning",
      lastTransitionAt: at(TTL + 1),
      createdAt: at(TTL + 1),
      ttlMs: TTL,
      now: NOW,
    }
    expect(decideRetryEligibility({ ...probe, lockHeld: null })).toEqual({
      ok: true,
      stalled: true,
    })
    // Omitting lockHeld entirely must behave the same as null.
    expect(decideRetryEligibility(probe)).toEqual({ ok: true, stalled: true })
  })
})
