import { describe, it, expect } from "vitest"
import {
  APT_OPTS_LITERAL,
  BOOTSTRAP_LOG,
  BOOTSTRAP_STATUS,
  CADDY_DEFAULT_VERSION,
  DISABLE_DEAD_APT_SOURCES,
  browserInstallStep,
  buildBootstrapFraming,
  caddyInstallCommands,
  caddyVersion,
  chromeInstallCommands,
} from "./bootstrap"

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

  // Prebake installs a Node major before the customer has picked a runtime,
  // and a BYOS box re-runs this whole script on every deploy. Both make the
  // nodejs step something that must be safe to run again.
  it("skips NodeSource when the box already runs the wanted major", () => {
    const script = buildBootstrapFraming({ ...opts, minNodeVersion: "24.16.0" }, "")
    expect(script).toContain("node_is_wanted")
    expect(script).toContain("NODE_MAJOR_WANTED=24")
    // Exact-major test, not a floor test: openclaw's engines range accepts
    // 24.x and 26.x but excludes 25.x, so a newer major is not automatically
    // acceptable.
    expect(script).toContain('"\${cur%%.*}" = "\${NODE_MAJOR_WANTED}"')
  })

  it("installs caddy on both branches, after node, not via an apt repo", () => {
    const script = buildBootstrapFraming({ ...opts, minNodeVersion: "24.16.0" }, "")
    // Caddy no longer rides along with nodejs — it has its own step after the
    // if/else, so the skip branch gets it too.
    expect(script).not.toContain("install -y nodejs caddy")
    expect(script.indexOf('step "install_caddy"')).toBeGreaterThan(script.indexOf("if node_is_wanted"))
    expect(script.indexOf('step "install_caddy"')).toBeGreaterThan(script.lastIndexOf('step "install_nodejs"'))
  })

  // The incident: NodeSource's setup script hit a failing `apt-get update`,
  // printed an error and exited 0. The NodeSource repo was never added, apt
  // installed Ubuntu's nodejs 18 with no npm, and the bootstrap died later on
  // "npm: command not found" — the cause scrolled away.
  it("refuses to continue when NodeSource did not register its repo", () => {
    const script = buildBootstrapFraming({ ...opts, minNodeVersion: "24.16.0" }, "")
    const installBranch = script.slice(
      script.indexOf("deb.nodesource.com/setup_24.x"),
      script.indexOf('step "install_caddy"'),
    )
    expect(installBranch).toContain('grep -rqs "deb.nodesource.com" /etc/apt/sources.list.d/')
    expect(installBranch.indexOf("grep -rqs")).toBeLessThan(
      installBranch.indexOf("apt-get $APT_OPTS install -y nodejs"),
    )
  })

  it("fails on the wrong Node major or a missing npm, whatever branch ran", () => {
    const script = buildBootstrapFraming({ ...opts, minNodeVersion: "24.16.0" }, "")
    const check = script.slice(script.indexOf("NODE_MAJOR_HAVE="), script.indexOf('step "install_caddy"'))
    expect(check).toContain('"${NODE_MAJOR_HAVE}" != "${NODE_MAJOR_WANTED}"')
    expect(check).toContain("command -v npm")
    expect(check).toContain("exit 1")
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

describe("chromeInstallCommands()", () => {
  // The bug this locks down: provisioner.ts carried a hand-copied "mirror" of
  // these commands that had drifted to `-o Acquire::Retries=3` alone. It is
  // the script that runs when someone enables the browser tool on an
  // already-running box — almost always a BYOS box, i.e. a real server with
  // unattended-upgrades holding the dpkg lock right after boot, which is the
  // exact situation DPkg::Lock::Timeout exists for. Without it apt fails
  // instantly rather than waiting its turn.
  it("carries the dpkg lock timeout wherever it is used", () => {
    expect(APT_OPTS_LITERAL).toContain("DPkg::Lock::Timeout=120")
    expect(chromeInstallCommands(APT_OPTS_LITERAL)).toContain("DPkg::Lock::Timeout=120")
  })

  it("takes its apt flags from the caller", () => {
    // Inside the framing that is the shell variable; outside it, the literal.
    expect(chromeInstallCommands("$APT_OPTS")).toContain("apt-get $APT_OPTS install -y")
    expect(chromeInstallCommands(APT_OPTS_LITERAL)).toContain(
      `apt-get ${APT_OPTS_LITERAL} install -y`,
    )
  })

  it("is the single source of the commands the bootstrap step emits", () => {
    expect(browserInstallStep()).toContain(chromeInstallCommands("$APT_OPTS"))
  })

  it("still installs Chrome rather than snap chromium", () => {
    const cmds = chromeInstallCommands("$APT_OPTS")
    expect(cmds).toContain("google-chrome-stable")
    expect(cmds).toContain("fonts-liberation")
    expect(cmds).not.toContain("chromium-browser")
  })
})

describe("buildBootstrapFraming() — apt options", () => {
  it("defines APT_OPTS from the shared literal", () => {
    expect(buildBootstrapFraming(opts, "")).toContain(`APT_OPTS="${APT_OPTS_LITERAL}"`)
  })
})

// Caddy's Cloudsmith apt repo has answered 402 since 2026-10-09, and one dead
// source fails every `apt-get update` — which failed every bootstrap.
describe("buildBootstrapFraming() — Caddy without Cloudsmith", () => {
  const script = buildBootstrapFraming({ ...opts, minNodeVersion: "24.16.0" }, "")

  it("never adds the Cloudsmith repository", () => {
    expect(script).not.toContain("cloudsmith.io")
    expect(script).not.toMatch(/tee \/etc\/apt\/sources\.list\.d\/caddy/)
  })

  it("disables a leftover Cloudsmith source before the first apt-get update", () => {
    // Every box bootstrapped before the outage still lists it; on a re-run
    // (BYOS) the very first update would fail.
    expect(script).toContain(DISABLE_DEAD_APT_SOURCES)
    expect(script.indexOf(DISABLE_DEAD_APT_SOURCES)).toBeLessThan(
      script.indexOf("apt-get $APT_OPTS update -y"),
    )
    // Renamed, not deleted: on a BYOS server the file may be the customer's.
    expect(DISABLE_DEAD_APT_SOURCES).toContain('mv -f "$f" "$f.disabled-by-atlas"')
    expect(DISABLE_DEAD_APT_SOURCES).toContain("/etc/apt/sources.list.d/caddy-stable.list")
  })

  it("installs the pinned release .deb from GitHub, checksum-verified", () => {
    expect(script).toContain(`CADDY_VERSION='${CADDY_DEFAULT_VERSION}'`)
    expect(script).toContain("https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}")
    expect(script).toContain('sha512sum -c --status -')
    // The default version carries a pinned hash rather than trusting the
    // release's own checksums file.
    expect(script).toMatch(/amd64\) CADDY_SHA512='[0-9a-f]{128}'/)
  })

  it("falls back to the distro caddy only when GitHub cannot be used", () => {
    const ifIdx = script.indexOf('if [ -n "${CADDY_SHA512}" ]')
    const elseIdx = script.indexOf("falling back to the distro package")
    expect(ifIdx).toBeGreaterThan(-1)
    expect(elseIdx).toBeGreaterThan(ifIdx)
    expect(script).toContain("install -y caddy")
  })

  it("never downgrades a caddy that is already new enough", () => {
    expect(script).toContain('dpkg --compare-versions "${CUR_CADDY}" ge "${CADDY_VERSION}"')
  })

  it("keeps an existing Caddyfile instead of stopping on a conffile prompt", () => {
    expect(caddyInstallCommands("$APT_OPTS")).toContain("--force-confold")
  })

  it("checks an overridden version against its release checksums file", () => {
    const cmds = caddyInstallCommands("$APT_OPTS", "2.99.0")
    expect(cmds).toContain("CADDY_VERSION='2.99.0'")
    expect(cmds).toContain("amd64) CADDY_SHA512='' ;;")
    expect(cmds).toContain("_checksums.txt")
  })

  it("rejects a CADDY_VERSION that is not a plain release number", () => {
    const prev = process.env.CADDY_VERSION
    try {
      process.env.CADDY_VERSION = "2.11.4; rm -rf /"
      expect(() => caddyVersion()).toThrow(/not a plain release number/)
      process.env.CADDY_VERSION = "2.11.7"
      expect(caddyVersion()).toBe("2.11.7")
      delete process.env.CADDY_VERSION
      expect(caddyVersion()).toBe(CADDY_DEFAULT_VERSION)
    } finally {
      if (prev === undefined) delete process.env.CADDY_VERSION
      else process.env.CADDY_VERSION = prev
    }
  })
})

describe("buildBootstrapFraming() — no origin-cert material", () => {
  // The cert used to be written here, i.e. into cloud-init user-data, which
  // anything on the droplet can read back from the metadata service. It is
  // now installed over SSH at configure time (agent-origin-cert.ts).
  it("writes nothing under /etc/caddy/cf", () => {
    const script = buildBootstrapFraming(opts, "")
    expect(script).not.toContain("/etc/caddy/cf")
    expect(script).not.toContain("BEGIN")
    expect(script).not.toContain("sovereignclaw")
  })
})
