import { describe, it, expect } from "vitest"

import {
  classifyProvisioning,
  LOCKLESS_GRACE_MS,
  type ProvisioningProbe,
} from "./provision-liveness"

const MIN = 60 * 1000
const base: ProvisioningProbe = { ageMs: 0, lockHeld: null, ttlMs: 60 * MIN }

describe("classifyProvisioning", () => {
  it("treats a held lock as live no matter how old the row is", () => {
    // The regression this exists for: a BYOS Hermes + Open WebUI install can
    // legitimately run past any fixed TTL, and the reconciler used to reclaim
    // it mid-flight purely on age.
    for (const ageMs of [0, 21 * MIN, 45 * MIN, 6 * 60 * MIN]) {
      expect(classifyProvisioning({ ...base, ageMs, lockHeld: true })).toBe("live")
    }
  })

  it("calls a lockless row dead once past the hand-off grace", () => {
    expect(
      classifyProvisioning({ ...base, ageMs: LOCKLESS_GRACE_MS + 1, lockHeld: false }),
    ).toBe("dead")
  })

  it("does not kill a provision that just started and has not taken its lock yet", () => {
    // The row flips to `provisioning` and the lock is acquired in separate
    // statements, so a freshly created row can briefly be lockless.
    expect(classifyProvisioning({ ...base, ageMs: 1_000, lockHeld: false })).toBe("live")
    expect(
      classifyProvisioning({ ...base, ageMs: LOCKLESS_GRACE_MS, lockHeld: false }),
    ).toBe("live")
  })

  it("declares a lockless row dead long before the TTL would", () => {
    // The point of the lock probe: recovery no longer waits out the TTL.
    const probe = { ...base, ageMs: 3 * MIN, lockHeld: false }
    expect(classifyProvisioning(probe)).toBe("dead")
    // Same age, unknown lock state → still not old enough to assume.
    expect(classifyProvisioning({ ...probe, lockHeld: null })).toBe("unknown")
  })

  it("falls back to the TTL when the lock state is unknown", () => {
    expect(classifyProvisioning({ ...base, ageMs: 59 * MIN, lockHeld: null })).toBe("unknown")
    expect(classifyProvisioning({ ...base, ageMs: 61 * MIN, lockHeld: null })).toBe("dead")
  })

  it("never returns unknown when the lock state is known", () => {
    for (const lockHeld of [true, false]) {
      for (const ageMs of [0, 5 * MIN, 120 * MIN]) {
        expect(classifyProvisioning({ ...base, ageMs, lockHeld })).not.toBe("unknown")
      }
    }
  })

  it("honours an overridden grace", () => {
    const probe = { ...base, ageMs: 30_000, lockHeld: false, locklessGraceMs: 10_000 }
    expect(classifyProvisioning(probe)).toBe("dead")
  })
})
