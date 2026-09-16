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
