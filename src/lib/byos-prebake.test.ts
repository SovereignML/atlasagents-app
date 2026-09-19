import { describe, it, expect } from "vitest"

import {
  PREBAKE_DISK_REQUIRED_GB,
  buildPrebakeScript,
  parsePrebakeVerify,
  prebakeDecision,
  prebakeMinNode,
  prebakeUsability,
} from "./byos-prebake"
import { HERMES_VPS_MIN_NODE } from "./runtimes/hermes"
import { OPENCLAW_VPS_MIN_NODE } from "./runtimes/openclaw"

const CLEAN = {
  port443Busy: false,
  hasCaddy: false,
  hasNginx: false,
  hasApache: false,
  diskAvailGb: 40,
}

const CONSENTED = new Date("2026-09-20T00:00:00Z")

describe("prebakeDecision()", () => {
  it("runs on a clean, consented server", () => {
    expect(prebakeDecision({ facts: CLEAN, consentAt: CONSENTED })).toEqual({ run: true })
  })

  // The preflight is read-only and unprivileged by design, and the connect
  // flow says so. Prebake is the moment that stops being true, so it does not
  // happen on an unrecorded consent — ever.
  it("refuses without recorded consent", () => {
    for (const consentAt of [null, undefined]) {
      const d = prebakeDecision({ facts: CLEAN, consentAt })
      expect(d.run).toBe(false)
      if (!d.run) expect(d.status).toBe("none")
    }
  })

  // The preflight deliberately does NOT block on these — it surfaces them and
  // tells the owner they are their call. Installing Caddy in the background
  // moments later would answer that call for them. Consent covers "you may
  // preinstall packages", not "you may reconfigure my web server".
  it("defers to deploy time when the box already serves the web", () => {
    for (const conflict of [
      { hasCaddy: true },
      { hasNginx: true },
      { hasApache: true },
      { port443Busy: true },
    ]) {
      const d = prebakeDecision({
        facts: { ...CLEAN, ...conflict },
        consentAt: CONSENTED,
      })
      expect(d.run).toBe(false)
      if (!d.run) expect(d.status).toBe("skipped")
    }
  })

  it("skips rather than fails when disk is tight", () => {
    const d = prebakeDecision({
      facts: { ...CLEAN, diskAvailGb: PREBAKE_DISK_REQUIRED_GB - 1 },
      consentAt: CONSENTED,
    })
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
    expect(
      prebakeDecision({ facts: { ...CLEAN, diskAvailGb: null }, consentAt: CONSENTED }),
    ).toEqual({ run: true })
  })
})

describe("prebakeMinNode()", () => {
  // At connect the engine is not chosen. A box given one runtime's major and
  // later handed the other's would be downgraded mid-deploy, so the prebake
  // must install a Node that satisfies both.
  it("picks a Node that satisfies both runtimes", () => {
    const chosen = prebakeMinNode()
    for (const floor of [OPENCLAW_VPS_MIN_NODE, HERMES_VPS_MIN_NODE]) {
      const [c, f] = [chosen.split(".").map(Number), floor.split(".").map(Number)]
      const satisfies =
        c[0] > f[0] || (c[0] === f[0] && (c[1] > f[1] || (c[1] === f[1] && c[2] >= f[2])))
      expect(satisfies).toBe(true)
    }
  })
})

describe("buildPrebakeScript()", () => {
  const script = buildPrebakeScript({
    openclawVersion: "2026.9.5",
    hermesVersion: "0.19.0",
    webuiVersion: "0.11.3",
    sshPort: 2222,
  })

  it("creates both runtimes' accounts, since the engine is unchosen", () => {
    expect(script).toContain("useradd --system --home-dir '/opt/hermes'")
    expect(script).toContain("useradd --system --home-dir '/opt/openclaw'")
  })

  it("installs the Hermes stack outright", () => {
    expect(script).toContain("hermes-agent==0.19.0")
    expect(script).toContain("open-webui==0.11.3")
    expect(script).toContain("install_pkgs_parallel")
  })

  // OpenClaw is the genuine either/or. Its 225MB / 11,428-file extract is the
  // expensive half and stays at deploy; only the download moves here.
  it("downloads OpenClaw without installing it", () => {
    expect(script).toContain("npm cache add 'openclaw@2026.9.5'")
    expect(script).not.toContain("npm install -g")
    expect(script).not.toContain("install_runtime")
  })

  it("never turns the customer's firewall on, and opens their real ssh port", () => {
    expect(script).toContain("ufw allow 2222/tcp")
    expect(script).not.toContain("ufw enable")
  })

  it("omits Chrome unless explicitly asked for", () => {
    expect(script).not.toContain("google-chrome-stable")
    const withBrowser = buildPrebakeScript({
      openclawVersion: null,
      hermesVersion: null,
      webuiVersion: null,
      browserDeps: true,
    })
    expect(withBrowser).toContain("google-chrome-stable")
  })

  // Without pins the prefetch is pointless — the deploy would re-resolve
  // `latest`, miss the cache and download everything again — but it must
  // still produce a working script rather than fail.
  it("degrades to unpinned specs when nothing is resolved", () => {
    const unpinned = buildPrebakeScript({
      openclawVersion: null,
      hermesVersion: null,
      webuiVersion: null,
    })
    expect(unpinned).toContain("npm cache add 'openclaw@latest'")
    expect(unpinned).toContain("RUNTIME_PKG_SPEC='hermes-agent'")
  })

  it("reuses the real bootstrap framing, so progress is reported the same way", () => {
    expect(script).toContain("/tmp/bootstrap.status")
    expect(script).toContain("/var/log/bootstrap.log")
    expect(script).toContain('echo "done" > "$STATUS"')
  })

  // The snippet bakes in a single gatewayPort and the engine is unknown here.
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
        "open_webui=1",
        "openclaw_cached=1",
        "hermes_unit=1",
        "disk_avail_gb=40",
      ].join("\n"),
    )
    expect(facts).toEqual({
      nodeVersion: "24.16.0",
      hasCaddy: true,
      hasUv: true,
      hermesVersion: "0.19.0",
      hasOpenWebui: true,
      hermesUnitInstalled: true,
      diskAvailGb: 40,
    })
  })

  it("survives a box where nothing is installed", () => {
    const facts = parsePrebakeVerify("node=\ncaddy=0\nhermes=\nopen_webui=0\n")
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
    hasOpenWebui: true,
    hermesUnitInstalled: true,
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
      facts: { ...READY, hasCaddy: false, hasOpenWebui: false },
      hermesPin: "0.19.0",
      minNodeVersion: "24.16.0",
    })
    expect(r.fastPath).toBe(false)
    expect(r.misses).toContain("caddy is not installed")
    expect(r.misses).toContain("open-webui is not installed")
  })

  it("notices a Node major that no longer matches", () => {
    const r = prebakeUsability({
      runtime: "openclaw",
      facts: { ...READY, nodeVersion: "22.14.0" },
      minNodeVersion: "24.16.0",
    })
    expect(r.fastPath).toBe(false)
    expect(r.misses.join(" ")).toMatch(/wanted major 24/)
  })

  // OpenClaw is only ever cached, never installed, so its absence is normal
  // and must not be reported as drift.
  it("does not expect Hermes to be present for an OpenClaw deploy", () => {
    expect(
      prebakeUsability({
        runtime: "openclaw",
        facts: { ...READY, hermesVersion: null, hasOpenWebui: false },
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
