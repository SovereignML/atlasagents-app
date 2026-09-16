import { describe, expect, it } from "vitest"
import {
  evaluatePreflight,
  isConnectable,
  parsePreflight,
  PREFLIGHT_SCRIPT,
  type PreflightFacts,
} from "./byos-preflight-parse"

// A clean Ubuntu 24.04 box, root, nothing else running on it.
const HEALTHY = [
  "cpu_cores=8",
  "load1=0.12",
  "mem_total_mb=16000",
  "mem_avail_mb=14000",
  "disk_total_gb=160",
  "disk_used_gb=12",
  "os_name=Ubuntu",
  "os_version=24.04",
  "kernel=6.8.0-40-generic",
  "uptime_sec=98765",
  "os_id=ubuntu",
  "os_codename=noble",
  "arch=x86_64",
  "uid=0",
  "sudo_ok=1",
  "ssh_port=",
  "port80_busy=0",
  "port443_busy=0",
  "has_caddy=0",
  "has_nginx=0",
  "has_apache=0",
  "ufw_active=0",
  "has_swap=1",
  "disk_avail_gb=140",
  "",
].join("\n")

function facts(over: Partial<PreflightFacts> = {}): PreflightFacts {
  return { ...parsePreflight(HEALTHY), ...over }
}

describe("PREFLIGHT_SCRIPT", () => {
  // It runs before we have any privilege guarantee, so it must not need root.
  it("asks about privilege rather than assuming it", () => {
    expect(PREFLIGHT_SCRIPT).toContain("sudo -n true")
    expect(PREFLIGHT_SCRIPT).toContain("id -u")
  })

  it("collects the facts the verdict depends on", () => {
    for (const key of ["os_id", "os_codename", "arch", "ssh_port", "port443_busy", "ufw_active"]) {
      expect(PREFLIGHT_SCRIPT).toContain(key)
    }
  })
})

describe("parsePreflight()", () => {
  it("parses a healthy box, hardware included", () => {
    const f = parsePreflight(HEALTHY)
    expect(f.osId).toBe("ubuntu")
    expect(f.osCodename).toBe("noble")
    expect(f.arch).toBe("x86_64")
    expect(f.uid).toBe(0)
    expect(f.sudoOk).toBe(true)
    expect(f.cpuCores).toBe(8)
    expect(f.ramTotalMb).toBe(16000)
    expect(f.diskAvailGb).toBe(140)
  })

  it("reads a declared non-default SSH port", () => {
    expect(parsePreflight(HEALTHY.replace("ssh_port=", "ssh_port=2222")).sshPort).toBe(2222)
  })

  // sshd_config often declares no Port at all; that means 22, not "unknown-bad".
  it("leaves the SSH port null when sshd_config declares none", () => {
    expect(parsePreflight(HEALTHY).sshPort).toBeNull()
  })

  it("lower-cases os identity so comparisons are stable", () => {
    const f = parsePreflight(HEALTHY.replace("os_id=ubuntu", "os_id=Ubuntu"))
    expect(f.osId).toBe("ubuntu")
  })

  it("returns an all-empty shape for empty input rather than throwing", () => {
    const f = parsePreflight("")
    expect(f.osId).toBeNull()
    expect(f.sudoOk).toBe(false)
    expect(f.port443Busy).toBe(false)
  })
})

describe("evaluatePreflight()", () => {
  it("passes a healthy box with nothing to report", () => {
    const v = evaluatePreflight(facts())
    expect(v.blockers).toEqual([])
    expect(v.conflicts).toEqual([])
    expect(isConnectable(v)).toBe(true)
  })

  it("blocks a distro we have no bootstrap for", () => {
    const v = evaluatePreflight(facts({ osId: "almalinux", osName: "AlmaLinux" }))
    expect(v.blockers.map((b) => b.code)).toContain("os_unsupported")
    expect(isConnectable(v)).toBe(false)
  })

  // Not a new limitation: Chrome ships no arm64 .deb, so an arm64 box would
  // fail partway through the install. Refusing up front is the honest version.
  it("blocks arm64", () => {
    const v = evaluatePreflight(facts({ arch: "aarch64" }))
    expect(v.blockers.map((b) => b.code)).toContain("arch_unsupported")
  })

  it("blocks a login that cannot reach root", () => {
    const v = evaluatePreflight(facts({ uid: 1000, sudoOk: false }))
    expect(v.blockers.map((b) => b.code)).toContain("no_root")
  })

  it("accepts a non-root login that has passwordless sudo", () => {
    const v = evaluatePreflight(facts({ uid: 1000, sudoOk: true }))
    expect(v.blockers).toEqual([])
  })

  it("blocks a box without room to install", () => {
    const v = evaluatePreflight(facts({ diskAvailGb: 2 }))
    expect(v.blockers.map((b) => b.code)).toContain("disk_low")
  })

  // The central design point: a busy :443 is the owner's business. We report it
  // and let them decide, rather than refusing to use their own machine.
  it("treats an occupied web port as a conflict, not a blocker", () => {
    const v = evaluatePreflight(facts({ port443Busy: true, hasNginx: true }))
    expect(v.blockers).toEqual([])
    expect(v.conflicts.map((c) => c.code)).toContain("web_ports_busy")
    expect(v.conflicts[0].message).toContain("nginx")
    expect(isConnectable(v)).toBe(true)
  })

  it("warns that an existing Caddyfile will be replaced, and says where the copy goes", () => {
    const v = evaluatePreflight(facts({ hasCaddy: true }))
    const c = v.conflicts.find((x) => x.code === "existing_caddyfile")
    expect(c).toBeDefined()
    expect(c?.fix).toContain("atlas-orig")
  })

  it("notes an active firewall without blocking", () => {
    const v = evaluatePreflight(facts({ ufwActive: true }))
    expect(v.blockers).toEqual([])
    expect(v.conflicts.map((c) => c.code)).toContain("ufw_active")
  })

  it("reports every blocker at once so the fix list is complete", () => {
    const v = evaluatePreflight(facts({ osId: "alpine", arch: "aarch64", sudoOk: false }))
    expect(v.blockers.map((b) => b.code).sort()).toEqual([
      "arch_unsupported",
      "no_root",
      "os_unsupported",
    ])
  })

  it("gives every blocker an actionable fix", () => {
    const v = evaluatePreflight(facts({ osId: "alpine", arch: "aarch64", sudoOk: false }))
    for (const b of v.blockers) expect(b.fix).toBeTruthy()
  })
})
