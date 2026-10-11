import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  OPEN_WEBUI_PREWARM_MARKER,
  SIDECAR_PREWARMED,
  buildCaptureBakeSecret,
  buildClaimPrewarmedSidecarScript,
  buildRestoreBakeSecret,
  buildReusePrewarmedSidecar,
  buildSidecarBakeSteps,
} from "./open-webui-claim"
import { buildBakeFinalizeScript } from "./finalize"

/**
 * These scripts run as root on customer boxes and decide which secret signs the
 * customer's sessions, so the cases below run them in bash against temp files,
 * with `systemctl` / `curl` / `sleep` stubbed on PATH and the absolute box paths
 * redirected into a temp dir.
 */
function sandbox(opts: { curlOk: boolean; active?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "owui-claim-"))
  const bin = join(dir, "bin")
  mkdirSync(bin)
  mkdirSync(join(dir, "systemd"))
  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  stub("systemctl", `echo "systemctl $*" >> ${JSON.stringify(join(dir, "calls"))}; [ "$1" = "is-active" ] && exit ${opts.active === false ? 1 : 0}; exit 0`)
  stub("curl", `exit ${opts.curlOk ? 0 : 7}`)
  stub("sleep", "exit 0")
  const marker = join(dir, "prewarmed")
  const run = (script: string) =>
    execFileSync(
      "bash",
      [
        "-c",
        script
          .replaceAll(OPEN_WEBUI_PREWARM_MARKER, marker)
          .replaceAll("/etc/systemd/system", join(dir, "systemd")),
      ],
      { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },
    )
  const calls = () => (existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8") : "")
  return { dir, marker, run, calls }
}

function bakeSteps(envPath: string, waitForReady: boolean): string {
  return buildSidecarBakeSteps({
    envB64: Buffer.from("WEBUI_SECRET_KEY=replaced-on-box\nENABLE_SIGNUP=true\n").toString("base64"),
    envPath,
    unitB64: Buffer.from("[Unit]\n").toString("base64"),
    serviceName: "open-webui",
    port: 8080,
    healthPath: "/health",
    waitForReady,
  })
}

const secretOf = (env: string) => env.match(/^WEBUI_SECRET_KEY=(.*)$/m)?.[1]

describe("buildSidecarBakeSteps", () => {
  it("replaces the placeholder with a random per-VM secret", () => {
    const a = sandbox({ curlOk: true })
    const b = sandbox({ curlOk: true })
    a.run(bakeSteps(join(a.dir, "owui.env"), true))
    b.run(bakeSteps(join(b.dir, "owui.env"), true))
    const envA = readFileSync(join(a.dir, "owui.env"), "utf8")
    const envB = readFileSync(join(b.dir, "owui.env"), "utf8")
    expect(secretOf(envA)).toMatch(/^[0-9a-f]{64}$/)
    expect(secretOf(envA)).not.toBe(secretOf(envB))
    expect(envA.match(/WEBUI_SECRET_KEY=/g)).toHaveLength(1)
    expect(envA).toContain("ENABLE_SIGNUP=true")
  })

  it("marks the box prewarmed only once Open WebUI answers", () => {
    const up = sandbox({ curlOk: true })
    up.run(bakeSteps(join(up.dir, "owui.env"), true))
    expect(existsSync(up.marker)).toBe(true)

    const down = sandbox({ curlOk: false })
    down.run(bakeSteps(join(down.dir, "owui.env"), true))
    expect(existsSync(down.marker)).toBe(false)
  })

  it("does not wait or mark when waitForReady is off (BYOS prebake)", () => {
    const s = sandbox({ curlOk: true })
    s.run(bakeSteps(join(s.dir, "owui.env"), false))
    expect(existsSync(s.marker)).toBe(false)
    expect(s.calls()).toContain("systemctl restart open-webui")
  })

  it("clears a stale marker before re-baking", () => {
    const s = sandbox({ curlOk: false })
    writeFileSync(s.marker, "")
    s.run(bakeSteps(join(s.dir, "owui.env"), true))
    expect(existsSync(s.marker)).toBe(false)
  })
})

describe("buildBakeFinalizeScript", () => {
  it("never ships a fixed session secret", () => {
    for (const waitForSidecar of [true, false]) {
      const script = buildBakeFinalizeScript("hermes", true, { waitForSidecar })
      expect(script).not.toContain("pool-placeholder-secret")
      expect(script).toContain("openssl rand -hex 32")
    }
  })

  it("waits for the sidecar only when asked", () => {
    expect(buildBakeFinalizeScript("hermes", true, { waitForSidecar: true })).toContain(OPEN_WEBUI_PREWARM_MARKER)
    expect(buildBakeFinalizeScript("hermes", true)).not.toContain("wait_ready")
  })
})

describe("claim: keep the bake secret", () => {
  function claimPhaseA(envPath: string, newEnv: string): string {
    return `set -euo pipefail
${buildCaptureBakeSecret(envPath)}
echo ${Buffer.from(newEnv).toString("base64")} | base64 -d > ${JSON.stringify(envPath)}
${buildRestoreBakeSecret(envPath)}
`
  }

  it("keeps the running sidecar's secret on a prewarmed box", () => {
    const s = sandbox({ curlOk: true })
    const envPath = join(s.dir, "owui.env")
    writeFileSync(envPath, "WEBUI_SECRET_KEY=bakesecret123\nOPENAI_API_KEY=pool-placeholder-token\n")
    writeFileSync(s.marker, "")
    s.run(claimPhaseA(envPath, "WEBUI_SECRET_KEY=claimsecret\nOPENAI_API_KEY=realtoken\n"))
    const env = readFileSync(envPath, "utf8")
    expect(secretOf(env)).toBe("bakesecret123")
    expect(env).toContain("OPENAI_API_KEY=realtoken")
    expect(env.match(/WEBUI_SECRET_KEY=/g)).toHaveLength(1)
  })

  it("uses the new secret when the box is not prewarmed", () => {
    const s = sandbox({ curlOk: true })
    const envPath = join(s.dir, "owui.env")
    writeFileSync(envPath, "WEBUI_SECRET_KEY=pool-placeholder-secret\n")
    s.run(claimPhaseA(envPath, "WEBUI_SECRET_KEY=claimsecret\n"))
    expect(secretOf(readFileSync(envPath, "utf8"))).toBe("claimsecret")
  })

  it("survives a missing env file under set -e", () => {
    const s = sandbox({ curlOk: true })
    const envPath = join(s.dir, "owui.env")
    writeFileSync(s.marker, "")
    s.run(claimPhaseA(envPath, "WEBUI_SECRET_KEY=claimsecret\n"))
    expect(secretOf(readFileSync(envPath, "utf8"))).toBe("claimsecret")
  })
})

describe("buildReusePrewarmedSidecar", () => {
  const script = (start: string) =>
    buildReusePrewarmedSidecar({ serviceName: "open-webui", port: 8080, healthPath: "/health", startCommand: start })

  it("keeps a healthy prewarmed sidecar running", () => {
    const s = sandbox({ curlOk: true })
    writeFileSync(s.marker, "")
    const out = s.run(script("echo STARTED"))
    expect(out).toContain(SIDECAR_PREWARMED)
    expect(out).not.toContain("STARTED")
  })

  it("starts it normally without the marker, or when unhealthy or inactive", () => {
    const noMarker = sandbox({ curlOk: true })
    expect(noMarker.run(script("echo STARTED"))).toContain("STARTED")

    const unhealthy = sandbox({ curlOk: false })
    writeFileSync(unhealthy.marker, "")
    expect(unhealthy.run(script("echo STARTED"))).toContain("STARTED")

    const inactive = sandbox({ curlOk: true, active: false })
    writeFileSync(inactive.marker, "")
    expect(inactive.run(script("echo STARTED"))).not.toContain(SIDECAR_PREWARMED)
  })
})

describe("buildClaimPrewarmedSidecarScript", () => {
  const script = buildClaimPrewarmedSidecarScript({
    port: 8080,
    envPath: "/opt/hermes/.hermes/open-webui.env",
    adminEmail: "admin+abc@hermes.local",
    adminPassword: "pa'ss$word",
  })

  it("embeds a Python program that compiles", () => {
    const py = script.split("<<'ATLAS_CLAIM_PY'\n")[1].split("\nATLAS_CLAIM_PY")[0]
    execFileSync("python3", ["-I", "-c", "import sys; compile(sys.stdin.read(), 'claim', 'exec')"], { input: py })
  })

  it("passes the password through bash intact", () => {
    const out = execFileSync(
      "bash",
      ["-c", `${script.split('"${PY}" -I')[0]}\necho "$OWUI_ADMIN_PASSWORD"`],
      { encoding: "utf8" },
    )
    expect(out.trim().split("\n").pop()).toBe("pa'ss$word")
  })
})
