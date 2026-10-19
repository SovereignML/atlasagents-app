import { describe, expect, it } from "vitest"
import {
  capacityByRuntime,
  estimateAgentCapacity,
  footprintKey,
  getFootprint,
  HOST_RESERVE,
} from "./agent-footprint"

// 8 vCPU / 16 GB / 160 GB — a typical mid-size VPS someone would bring.
const MIDSIZE = { cpuCores: 8, ramTotalMb: 16384, diskTotalGb: 160 }

describe("estimateAgentCapacity()", () => {
  it("sizes a mid-size box against the default runtime", () => {
    // (8-1)/1 cpu, (16384-1024)/1024 = 15 ram, (160-5)/3 = 51 disk → CPU-bound.
    expect(estimateAgentCapacity(MIDSIZE)).toBe(7)
  })

  it("fits fewer of the heavier variants", () => {
    const byRuntime = capacityByRuntime(MIDSIZE)
    expect(byRuntime["openclaw"]).toBeGreaterThanOrEqual(byRuntime["hermes-lite"])
    expect(byRuntime["hermes"]).toBeGreaterThanOrEqual(byRuntime["hermes-lite"])
  })

  it("takes the binding constraint, not the most generous one", () => {
    // Plenty of CPU and disk, but only enough RAM past the reserve for one.
    const ramStarved = { cpuCores: 16, ramTotalMb: HOST_RESERVE.ramMb + 1024, diskTotalGb: 500 }
    expect(estimateAgentCapacity(ramStarved)).toBe(1)
  })

  it("returns 0 for a box too small to host anything", () => {
    expect(estimateAgentCapacity({ cpuCores: 1, ramTotalMb: 512, diskTotalGb: 10 })).toBe(0)
  })

  // A box can be big enough for OpenClaw and still too small for the Hermes + chat UI
  // variant — the UI needs that distinction to disable the right options.
  it("can fit the light runtime but not the heavy one", () => {
    const small = { cpuCores: 2, ramTotalMb: 2048, diskTotalGb: 20 }
    expect(estimateAgentCapacity(small, "openclaw")).toBe(1)
    expect(estimateAgentCapacity(small, "hermes-lite")).toBe(0)
  })

  // Never show a negative or a fabricated number before the first probe lands.
  it("returns 0 when the host has not been probed", () => {
    expect(estimateAgentCapacity({ cpuCores: null, ramTotalMb: null, diskTotalGb: null })).toBe(0)
    expect(estimateAgentCapacity({ cpuCores: 8, ramTotalMb: null, diskTotalGb: 160 })).toBe(0)
  })

  it("never returns a negative capacity", () => {
    expect(estimateAgentCapacity({ cpuCores: 0, ramTotalMb: 0, diskTotalGb: 0 })).toBe(0)
  })

  it("returns 0 for an unknown runtime key rather than guessing", () => {
    expect(estimateAgentCapacity(MIDSIZE, "nope")).toBe(0)
  })
})

describe("footprintKey()", () => {
  it("separates Hermes with and without the sidecar", () => {
    expect(footprintKey("hermes", true)).toBe("hermes-lite")
    expect(footprintKey("hermes", false)).toBe("hermes")
  })

  it("ignores the sidecar flag for runtimes that have none", () => {
    expect(footprintKey("openclaw", true)).toBe("openclaw")
  })

  it("sizes the coding agents with their chat UI", () => {
    expect(footprintKey("codex", true)).toBe("codex-lite")
    expect(getFootprint("codex-lite")!.ramMb).toBeGreaterThan(getFootprint("hermes")!.ramMb)
  })
})
