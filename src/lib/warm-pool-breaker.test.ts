import { describe, it, expect } from "vitest"

import {
  describeBakeFailure,
  describeOpenCircuit,
  isChurnedVm,
  MIN_VIABLE_AGE_MS,
  FAILURE_WINDOW_MS,
  isCircuitOpen,
  MAX_FAILURES_PER_WINDOW,
  pruneFailures,
  recordFailure,
  retryAfterMs,
} from "./warm-pool-breaker"

const NOW = new Date("2026-09-18T12:00:00Z").getTime()
const MIN = 60 * 1000

describe("warm-pool circuit breaker", () => {
  it("stays closed while failures are below the threshold", () => {
    let state: readonly number[] = []
    for (let i = 1; i < MAX_FAILURES_PER_WINDOW; i++) {
      state = recordFailure(state, NOW)
      expect(isCircuitOpen(state, NOW)).toBe(false)
    }
  })

  it("opens on the threshold failure, stopping the create/destroy loop", () => {
    let state: readonly number[] = []
    for (let i = 0; i < MAX_FAILURES_PER_WINDOW; i++) state = recordFailure(state, NOW)
    expect(isCircuitOpen(state, NOW)).toBe(true)
  })

  it("closes again once failures age out of the window", () => {
    let state: readonly number[] = []
    for (let i = 0; i < MAX_FAILURES_PER_WINDOW; i++) state = recordFailure(state, NOW)
    expect(isCircuitOpen(state, NOW)).toBe(true)

    // A pool that was broken and has been fixed must refill unattended.
    const later = NOW + FAILURE_WINDOW_MS + 1
    expect(isCircuitOpen(state, later)).toBe(false)
    expect(pruneFailures(state, later)).toEqual([])
  })

  it("does not trip on failures spread thinly over a long period", () => {
    // One failure per window is noise, not a broken bake.
    let state: readonly number[] = []
    let t = NOW
    for (let i = 0; i < 10; i++) {
      t += FAILURE_WINDOW_MS + MIN
      state = recordFailure(state, t)
      expect(isCircuitOpen(state, t)).toBe(false)
    }
  })

  it("reports when it will close", () => {
    let state: readonly number[] = []
    for (let i = 0; i < MAX_FAILURES_PER_WINDOW; i++) state = recordFailure(state, NOW)
    // Oldest failure was at NOW, so it expires one window later.
    expect(retryAfterMs(state, NOW + 10 * MIN)).toBe(FAILURE_WINDOW_MS - 10 * MIN)
    expect(retryAfterMs([], NOW)).toBe(0)
  })

  it("honours overridden thresholds", () => {
    const opts = { windowMs: 10 * MIN, maxFailures: 2 }
    let state: readonly number[] = []
    state = recordFailure(state, NOW, opts)
    expect(isCircuitOpen(state, NOW, opts)).toBe(false)
    state = recordFailure(state, NOW, opts)
    expect(isCircuitOpen(state, NOW, opts)).toBe(true)
    expect(isCircuitOpen(state, NOW + 11 * MIN, opts)).toBe(false)
  })

  it("explains itself with the pool key and where to look", () => {
    let state: readonly number[] = []
    for (let i = 0; i < MAX_FAILURES_PER_WINDOW; i++) state = recordFailure(state, NOW)
    const msg = describeOpenCircuit("linode|g6-standard-2|eu-central|hermes|1", state, NOW)
    expect(msg).toContain("linode|g6-standard-2|eu-central|hermes|1")
    // It must NOT send the operator to WarmVm.lastError: the reaper deletes
    // that row seconds after the failure, so the advice used to point at a
    // table that is empty by the time anyone reads the warning.
    expect(msg).toContain("OrphanEvent")
    expect(msg).not.toMatch(/Check WarmVm\.lastError/)
  })

  describe("describeBakeFailure — the record that outlives the row", () => {
    const facts = {
      poolKey: "digitalocean|s-2vcpu-4gb|fra1|hermes|1",
      vmId: "do-4711",
      status: "failed",
      createdAtMs: NOW - 4 * MIN,
      reason: 'bootstrap failed:install_runtime_pkg\n--- bootstrap.log tail ---\nKilled',
    }

    it("carries every fact that dies with the row", () => {
      const msg = describeBakeFailure(facts, NOW)
      // Which pool — one runtime broken, or all of them?
      expect(msg).toContain("digitalocean|s-2vcpu-4gb|fra1|hermes|1")
      // Which VM — so the line reconciles against the provider bill.
      expect(msg).toContain("do-4711")
      // How long it survived — instant death vs. a slow timeout are different bugs.
      expect(msg).toContain("age=240s")
      // And the actual evidence, which is the whole point.
      expect(msg).toContain("install_runtime_pkg")
      expect(msg).toContain("Killed")
    })

    it("stays readable when the provider never returned a VM id", () => {
      const msg = describeBakeFailure({ ...facts, vmId: null, status: "creating" }, NOW)
      expect(msg).toContain("vmId=(none)")
      expect(msg).toContain("status=creating")
    })

    it("does not emit a negative or NaN age from a missing/odd createdAt", () => {
      expect(describeBakeFailure({ ...facts, createdAtMs: null }, NOW)).toContain("age=?s")
      // Clock skew between the app and Postgres must not produce "age=-3s".
      expect(describeBakeFailure({ ...facts, createdAtMs: NOW + 3000 }, NOW)).toContain("age=0s")
    })
  })

  it("prunes without mutating the input", () => {
    const state = [NOW - FAILURE_WINDOW_MS - 1, NOW]
    const pruned = pruneFailures(state, NOW)
    expect(pruned).toEqual([NOW])
    expect(state).toHaveLength(2)
  })

  describe("isChurnedVm — the shape-independent waste signal", () => {
    it("flags a VM destroyed before it could ever have been useful", () => {
      // A successful bake alone takes minutes. Anything torn down this fast was
      // billed and never usable, whatever reap rule claims responsibility.
      expect(isChurnedVm(NOW - 2 * MIN, NOW)).toBe(true)
      expect(isChurnedVm(NOW - 14 * MIN, NOW)).toBe(true)
    })

    it("leaves the legitimate long-lived reaps alone", () => {
      // The 3-day `ready` recycle and a config-change retirement both act on
      // VMs that have been alive for hours. Counting those as failures would
      // open the breaker during normal operation.
      expect(isChurnedVm(NOW - 16 * MIN, NOW)).toBe(false)
      expect(isChurnedVm(NOW - 3 * 24 * 60 * MIN, NOW)).toBe(false)
    })

    it("does not open the breaker on an unknown age", () => {
      // A missing createdAt is absent evidence, not evidence of churn.
      expect(isChurnedVm(null, NOW)).toBe(false)
    })

    it("is exactly bounded at the threshold", () => {
      expect(isChurnedVm(NOW - MIN_VIABLE_AGE_MS, NOW)).toBe(false)
      expect(isChurnedVm(NOW - MIN_VIABLE_AGE_MS + 1, NOW)).toBe(true)
    })

    it("catches the loop shape the failure counter was blind to", () => {
      // The original breaker only counted bake failures. A pool whose VMs are
      // reaped as "stale key" seconds after creation never registers a bake
      // failure at all — but it burns money at exactly the same rate. Three
      // such reaps must open the circuit just like three failed bakes.
      let state: readonly number[] = []
      let t = NOW
      for (let i = 0; i < MAX_FAILURES_PER_WINDOW; i++) {
        const createdAt = t
        t += 60 * 1000 // destroyed one refill tick later
        expect(isChurnedVm(createdAt, t)).toBe(true)
        state = recordFailure(state, t)
      }
      expect(isCircuitOpen(state, t)).toBe(true)
    })
  })
})
