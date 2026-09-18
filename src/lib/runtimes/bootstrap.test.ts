import { describe, it, expect } from "vitest"
import { buildBootstrapFraming, BOOTSTRAP_STATUS, BOOTSTRAP_LOG } from "./bootstrap"

const opts = {
  installDir: "/opt/openclaw",
  systemUser: "openclaw",
  minNodeVersion: "22.14.0",
  gatewayPort: 3000,
}

describe("buildBootstrapFraming() — stale status/log reset", () => {
  const script = buildBootstrapFraming(opts, `step "noop"\ntrue\n`)

  it("removes any stale status + log before the first status write", () => {
    const rmIdx = script.indexOf(`rm -f "$STATUS" "$LOG"`)
    const firstWriteIdx = script.indexOf(`echo "running" > "$STATUS"`)
    expect(rmIdx).toBeGreaterThan(-1)
    expect(firstWriteIdx).toBeGreaterThan(-1)
    // The reset must happen BEFORE the first write, or a reused BYOS box with a
    // root-owned leftover status file fails the write under set -e.
    expect(rmIdx).toBeLessThan(firstWriteIdx)
  })

  it("tolerates a missing/unwritable file so the reset never aborts the bootstrap", () => {
    expect(script).toContain(`rm -f "$STATUS" "$LOG" 2>/dev/null || true`)
  })

  it("ensures the log directory exists before writing", () => {
    expect(script).toContain(`mkdir -p "$(dirname "$LOG")"`)
  })

  // Bash does not wait for `>(tee ...)` before exiting, so an abrupt set -e
  // abort could in principle lose the tail of the log — the only part anyone
  // reads, and the only part that says what actually broke. Hardening, not a
  // fix for a reproduced truncation.
  it("drains the log pipe before exiting so the failing output survives", () => {
    const statusIdx = script.indexOf(`echo "failed:\${CURRENT_STEP}" > "$STATUS"`)
    const drainIdx = script.indexOf("exec 1>&- 2>&-")
    expect(statusIdx).toBeGreaterThan(-1)
    expect(drainIdx).toBeGreaterThan(-1)
    // The step name must be recorded BEFORE we start tearing down the pipe, so
    // a failed drain can never cost us the step name as well.
    expect(statusIdx).toBeLessThan(drainIdx)
  })

  it("still wires the shared status/log contract used by the poller", () => {
    expect(script).toContain(`STATUS="${BOOTSTRAP_STATUS}"`)
    expect(script).toContain(`LOG="${BOOTSTRAP_LOG}"`)
    expect(script).toContain(`echo "done" > "$STATUS"`)
  })
})

describe("buildBootstrapFraming() — firewall", () => {
  const body = `step "noop"\ntrue\n`

  it("opens port 22 and enables ufw on a host we own", () => {
    const script = buildBootstrapFraming(opts, body)
    expect(script).toContain("ufw allow 22/tcp")
    expect(script).toContain("yes | ufw enable")
  })

  // The lockout bug: the firewall step hardcoded 22, so a BYOS server whose
  // sshd listens elsewhere had ufw enabled with SSH blocked — locking out both
  // the platform and the machine's owner.
  it("opens the SSH port the server actually uses", () => {
    const script = buildBootstrapFraming({ ...opts, sshPort: 2222 }, body)
    expect(script).toContain("ufw allow 2222/tcp")
    expect(script).not.toContain("ufw allow 22/tcp")
  })

  it("never enables the firewall on a server we do not own", () => {
    const script = buildBootstrapFraming(
      { ...opts, sshPort: 2222, manageFirewall: false },
      body,
    )
    expect(script).not.toContain("ufw enable")
    // Allow-rules are still added, so the agent is reachable if the customer
    // already runs a firewall.
    expect(script).toContain("ufw allow 2222/tcp")
    expect(script).toContain("ufw allow 443/tcp")
  })

  it("defaults to managing the firewall so managed VPS behaviour is unchanged", () => {
    expect(buildBootstrapFraming({ ...opts, manageFirewall: undefined }, body)).toContain(
      "yes | ufw enable",
    )
  })
})

describe("buildBootstrapFraming() — host-state safety", () => {
  const script = buildBootstrapFraming(opts, `step "noop"\ntrue\n`)

  // A customer box often already has a swap partition; the old check only
  // looked for /swapfile and would add a second, redundant 2G file.
  it("skips swap creation when the host already has swap", () => {
    expect(script).toContain("/proc/swaps")
    expect(script).toContain("EXISTING_SWAP")
  })

  // swapon fails on LXC/OpenVZ, which aborted the whole bootstrap under set -e.
  it("does not abort when swap cannot be enabled", () => {
    expect(script).toContain("rm -f /swapfile")
    expect(script).not.toMatch(/^swapon \/swapfile$/m)
  })

  // unattended-upgrades holds the dpkg lock for minutes after boot on a real
  // server; without a timeout every apt call fails instantly.
  it("waits for the dpkg lock instead of failing instantly", () => {
    expect(script).toContain("DPkg::Lock::Timeout=120")
  })
})

describe("buildBootstrapFraming() — Node version contract", () => {
  // The bug this locks down: the framing hardcoded `setup_22.x` while
  // `minNodeVersion` was a parameter, so a runtime could declare one Node and
  // the box could get another. OpenClaw declared 22.14.0, got Node 22, passed
  // verify_node, and then npm refused the package with EBADENGINE because it
  // requires >=24.16 — failing every fresh OpenClaw bootstrap at
  // `install_runtime`, which the warm pool then retried forever.
  it("installs the NodeSource major the runtime actually asks for", () => {
    expect(buildBootstrapFraming({ ...opts, minNodeVersion: "24.16.0" }, "")).toContain(
      "deb.nodesource.com/setup_24.x",
    )
    expect(buildBootstrapFraming({ ...opts, minNodeVersion: "22.14.0" }, "")).toContain(
      "deb.nodesource.com/setup_22.x",
    )
  })

  it("never installs a Node older than the runtime's declared minimum", () => {
    for (const min of ["22.14.0", "24.16.0", "26.1.0"]) {
      const script = buildBootstrapFraming({ ...opts, minNodeVersion: min }, "")
      const installed = Number(script.match(/setup_(\d+)\.x/)?.[1])
      expect(installed).toBe(Number(min.split(".")[0]))
      // verify_node checks the same value, so the two can no longer disagree.
      expect(script).toContain(`RUNTIME_MIN_NODE='${min}'`)
    }
  })

  it("refuses a minNodeVersion it cannot derive a major from", () => {
    // Failing at render time is the point: a silently wrong Node major is what
    // produced an endless create/fail/destroy loop in production.
    expect(() => buildBootstrapFraming({ ...opts, minNodeVersion: "latest" }, "")).toThrow(
      /Cannot derive a NodeSource major/,
    )
    expect(() => buildBootstrapFraming({ ...opts, minNodeVersion: "" }, "")).toThrow()
  })
})
