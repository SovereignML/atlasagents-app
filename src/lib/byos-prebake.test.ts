import { describe, it, expect } from "vitest"

import {
  PREBAKE_DISK_REQUIRED_GB,
  buildPrebakeScript,
  parsePrebakeVerify,
  prebakeDecision,
  prebakeMinNode,
  prebakeUsability,
} from "./byos-prebake"
import { HERMES_PINNED_VERSION, HERMES_VPS_MIN_NODE } from "./runtimes/hermes"
import { BYOS_RUNTIME_IDS } from "./runtimes/ids"
import { LITE_ENGINES } from "./runtimes/universal"
import { getRuntime } from "./runtimes"

const CLEAN = {
  port443Busy: false,
  hasCaddy: false,
  hasNginx: false,
  hasApache: false,
  diskAvailGb: 40,
}

describe("prebakeDecision()", () => {
  // Connecting the server is the go-ahead: there is no opt-in to wait for.
  it("runs on a clean server, with Caddy", () => {
    expect(prebakeDecision({ facts: CLEAN })).toEqual({ run: true, installCaddy: true })
  })

  // The preflight leaves a busy :443 or another web server to the owner, at
  // install time. Installing Caddy in the background would answer that for
  // them, so it waits for the deploy; everything else still installs.
  it("installs everything but Caddy when the box already serves the web", () => {
    for (const conflict of [{ hasNginx: true }, { hasApache: true }, { port443Busy: true }]) {
      expect(prebakeDecision({ facts: { ...CLEAN, ...conflict } })).toEqual({
        run: true,
        installCaddy: false,
      })
    }
  })

  // An existing Caddy (on :443 or not) is kept by the bootstrap itself.
  it("leaves an existing Caddy alone", () => {
    expect(prebakeDecision({ facts: { ...CLEAN, hasCaddy: true, port443Busy: true } })).toEqual({
      run: true,
      installCaddy: false,
    })
  })

  it("skips rather than fails when disk is tight", () => {
    const d = prebakeDecision({ facts: { ...CLEAN, diskAvailGb: PREBAKE_DISK_REQUIRED_GB - 1 } })
    expect(d.run).toBe(false)
    // Deploying must still be possible — just slower. A tight disk is not a
    // reason to refuse the customer's server.
    if (!d.run) {
      expect(d.status).toBe("skipped")
      expect(d.reason).toMatch(/still work/i)
    }
  })

  it("proceeds when disk is unknown", () => {
    // The probe can come back without a figure; that is not evidence of a
    // problem, and the bootstrap fails loudly on its own if space runs out.
    expect(prebakeDecision({ facts: { ...CLEAN, diskAvailGb: null } }).run).toBe(true)
  })
})

describe("BYOS engines", () => {
  // Every engine BYOS offers must be on the prebaked image, or its deploy
  // would install from scratch on a server the customer was told is ready.
  it("are exactly the universal image's engines", () => {
    expect([...BYOS_RUNTIME_IDS].sort()).toEqual([...LITE_ENGINES].sort())
    expect(BYOS_RUNTIME_IDS).not.toContain("openclaw")
  })
})

describe("prebakeMinNode()", () => {
  // At connect the engine is not chosen, so the Node must satisfy every one.
  it("picks a Node that satisfies every BYOS engine", () => {
    const chosen = prebakeMinNode()
    for (const floor of [HERMES_VPS_MIN_NODE, ...LITE_ENGINES.map((id) => getRuntime(id).minNode)]) {
      const [c, f] = [chosen.split(".").map(Number), floor.split(".").map(Number)]
      const satisfies =
        c[0] > f[0] || (c[0] === f[0] && (c[1] > f[1] || (c[1] === f[1] && c[2] >= f[2])))
      expect(satisfies).toBe(true)
    }
  })
})

describe("buildPrebakeScript()", () => {
  const script = buildPrebakeScript({ hermesVersion: "0.19.0", sshPort: 2222 })

  it("creates every BYOS engine's account, since the engine is unchosen", () => {
    for (const id of LITE_ENGINES) {
      expect(script).toContain(`useradd --system --home-dir '${getRuntime(id).paths.installDir}'`)
    }
  })

  it("installs the universal image: every engine and the chat UI", () => {
    expect(script).toContain("hermes-agent[acp,messaging]==0.19.0")
    expect(script).toContain("agentwebui-lite")
    for (const id of LITE_ENGINES) expect(script).toContain(`=== universal: ${id} ===`)
  })

  it("installs nothing of OpenClaw", () => {
    expect(script).not.toContain("openclaw@")
    expect(script).not.toContain("/opt/openclaw")
    expect(script).not.toContain("npm cache add")
  })

  it("never turns the customer's firewall on, and opens their real ssh port", () => {
    expect(script).toContain("ufw allow 2222/tcp")
    expect(script).not.toContain("ufw enable")
  })

  it("leaves Caddy out when asked to", () => {
    expect(script).toContain('step "install_caddy"')
    const noCaddy = buildPrebakeScript({ hermesVersion: null, installCaddy: false })
    expect(noCaddy).not.toContain('step "install_caddy"')
    expect(noCaddy).toContain("install_caddy skipped")
  })

  it("omits Chrome unless explicitly asked for", () => {
    expect(script).not.toContain("google-chrome-stable")
    expect(buildPrebakeScript({ hermesVersion: null, browserDeps: true })).toContain(
      "google-chrome-stable",
    )
  })

  // Nothing resolved must still install exactly what the deploy installs: the
  // code pin. Falling back to `latest` would bake a version the deploy never
  // asks for.
  it("falls back to the Hermes code pin when nothing is resolved", () => {
    expect(buildPrebakeScript({ hermesVersion: null })).toContain(
      `RUNTIME_PKG_SPEC='hermes-agent[acp,messaging]==${HERMES_PINNED_VERSION}'`,
    )
  })

  it("reuses the real bootstrap framing, so progress is reported the same way", () => {
    expect(script).toContain("/tmp/bootstrap.status")
    expect(script).toContain("/var/log/bootstrap.log")
    expect(script).toContain('echo "done" > "$STATUS"')
  })

  // Warming the CLI is what makes the deploy fast; it runs before "done".
  it("warms the Hermes CLI before reporting done", () => {
    expect(script).toContain("prebake_finalize")
    expect(script).toContain("setup --non-interactive --quick")
    expect(script).toContain("doctor --fix")
    expect(script.indexOf("prebake_finalize")).toBeLessThan(script.indexOf('echo "done" > "$STATUS"'))
  })

  // Which engine runs is decided at deploy, as at a pool claim: no unit is
  // written for any of them here.
  it("writes no engine's systemd unit", () => {
    expect(script).not.toContain("/etc/systemd/system/hermes-gateway.service")
  })

  it("writes no Cloudflare origin-cert snippet", () => {
    expect(script).not.toContain("cf_origin_cert")
    expect(script).not.toContain("sovereignclaw.caddy")
  })
})

describe("parsePrebakeVerify()", () => {
  it("reads the probe output", () => {
    const facts = parsePrebakeVerify(
      [
        "node=24.16.0",
        "caddy=1",
        "uv=1",
        "hermes=0.19.0",
        "lite=1",
        "disk_avail_gb=40",
      ].join("\n"),
    )
    expect(facts).toEqual({
      nodeVersion: "24.16.0",
      hasCaddy: true,
      hasUv: true,
      hermesVersion: "0.19.0",
      liteInstalled: true,
      diskAvailGb: 40,
    })
  })

  it("survives a box where nothing is installed", () => {
    const facts = parsePrebakeVerify("node=\ncaddy=0\nhermes=\n")
    expect(facts.nodeVersion).toBeNull()
    expect(facts.hasCaddy).toBe(false)
    expect(facts.hermesVersion).toBeNull()
  })

  it("survives junk", () => {
    const facts = parsePrebakeVerify("bash: command not found\n\n???")
    expect(facts.nodeVersion).toBeNull()
    expect(facts.diskAvailGb).toBeNull()
  })
})

describe("prebakeUsability()", () => {
  const READY = {
    nodeVersion: "24.16.0",
    hasCaddy: true,
    hasUv: true,
    hermesVersion: "0.19.0",
    liteInstalled: true,
    diskAvailGb: 40,
  }

  it("takes the fast path on a properly prebaked box", () => {
    expect(
      prebakeUsability({
        runtime: "hermes",
        facts: READY,
        hermesPin: "0.19.0",
        minNodeVersion: "24.16.0",
      }).fastPath,
    ).toBe(true)
  })

  // The whole point of verifying observed state: a customer can apt-remove
  // something, or rebuild the machine behind the same IP, long after the
  // prebake marked the row ready.
  it("notices a box that has drifted since the prebake", () => {
    const r = prebakeUsability({
      runtime: "hermes",
      facts: { ...READY, hasCaddy: false },
      hermesPin: "0.19.0",
      minNodeVersion: "24.16.0",
    })
    expect(r.fastPath).toBe(false)
    expect(r.misses).toContain("caddy is not installed")
  })

  it("notices a missing chat UI", () => {
    const r = prebakeUsability({
      runtime: "claude-code",
      facts: { ...READY, liteInstalled: false },
      minNodeVersion: "24.16.0",
    })
    expect(r.fastPath).toBe(false)
    expect(r.misses).toContain("the chat UI is not installed")
  })

  it("notices a Node major that no longer matches", () => {
    const r = prebakeUsability({
      runtime: "codex",
      facts: { ...READY, nodeVersion: "22.14.0" },
      minNodeVersion: "24.16.0",
    })
    expect(r.fastPath).toBe(false)
    expect(r.misses.join(" ")).toMatch(/wanted major 24/)
  })

  // Hermes' version only matters to a Hermes deploy.
  it("does not check Hermes' version for another engine's deploy", () => {
    expect(
      prebakeUsability({
        runtime: "claude-code",
        facts: { ...READY, hermesVersion: null },
        minNodeVersion: "24.16.0",
      }).fastPath,
    ).toBe(true)
  })

  it("flags a pin mismatch without treating it as fatal", () => {
    const r = prebakeUsability({
      runtime: "hermes",
      facts: READY,
      hermesPin: "0.18.2",
      minNodeVersion: "24.16.0",
    })
    expect(r.fastPath).toBe(false)
    expect(r.misses.join(" ")).toMatch(/pinned to 0\.18\.2/)
  })
})
