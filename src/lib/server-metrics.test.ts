import { describe, expect, it } from "vitest"
import { parseServerMetrics } from "./server-metrics-parse"

// A representative probe stdout from a healthy Ubuntu box.
const HEALTHY = [
  "cpu_cores=4",
  "load1=0.42",
  "mem_total_mb=7976",
  "mem_avail_mb=6100",
  "disk_total_gb=80",
  "disk_used_gb=23",
  "os_name=Ubuntu 22.04.4 LTS",
  "os_version=22.04",
  "kernel=5.15.0-101-generic",
  "uptime_sec=372045",
  "",
].join("\n")

describe("parseServerMetrics", () => {
  it("parses a full healthy snapshot", () => {
    const s = parseServerMetrics(HEALTHY)
    expect(s.cpuCores).toBe(4)
    expect(s.cpuLoad1).toBeCloseTo(0.42)
    expect(s.ramTotalMb).toBe(7976)
    expect(s.diskTotalGb).toBe(80)
    expect(s.diskUsedGb).toBe(23)
    expect(s.osName).toBe("Ubuntu 22.04.4 LTS")
    expect(s.osVersion).toBe("22.04")
    expect(s.kernel).toBe("5.15.0-101-generic")
    expect(s.uptimeSec).toBe(372045)
  })

  it("derives RAM used as total minus available", () => {
    expect(parseServerMetrics(HEALTHY).ramUsedMb).toBe(7976 - 6100)
  })

  it("never returns a negative RAM used", () => {
    // available > total (shouldn't happen, but be defensive) clamps to 0.
    const s = parseServerMetrics("mem_total_mb=100\nmem_avail_mb=200")
    expect(s.ramUsedMb).toBe(0)
  })

  it("maps blank / missing values to null rather than NaN", () => {
    const s = parseServerMetrics(
      ["cpu_cores=", "os_name=", "disk_total_gb=", "load1="].join("\n"),
    )
    expect(s.cpuCores).toBeNull()
    expect(s.osName).toBeNull()
    expect(s.diskTotalGb).toBeNull()
    expect(s.cpuLoad1).toBeNull()
    expect(s.ramUsedMb).toBeNull() // no mem lines at all
  })

  it("ignores non key=value lines and preserves '=' inside values", () => {
    const s = parseServerMetrics(
      ["garbage line", "os_name=Debian GNU/Linux 12 (bookworm)", "kernel=6.1.0-a=b"].join("\n"),
    )
    expect(s.osName).toBe("Debian GNU/Linux 12 (bookworm)")
    expect(s.kernel).toBe("6.1.0-a=b")
  })

  it("returns an all-null snapshot for empty input", () => {
    const s = parseServerMetrics("")
    expect(Object.values(s).every((v) => v === null)).toBe(true)
  })
})
