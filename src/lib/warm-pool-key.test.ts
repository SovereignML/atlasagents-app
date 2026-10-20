import { afterEach, describe, it, expect } from "vitest"
import { bakeIdentity, poolKeyFor, poolRuntimeFor } from "./warm-pool-key"
import { OPENCLAW_PINNED_VERSION } from "./runtimes/openclaw"
import { HERMES_PINNED_VERSION } from "./runtimes/hermes"
import { liteVersion } from "./runtimes/agentwebui-lite"
import { LITE_ENGINES } from "./runtimes/universal"

const VARS = [
  "OPENCLAW_VERSION",
  "HERMES_VERSION",
  "ATLAS_OPENCODE_VERSION",
  "AGENTWEBUI_LITE_PIP_SPEC",
  "CLOUDFLARE_BASE_DOMAIN",
  "CLOUDFLARE_AGENT_DOMAIN",
  "CLOUDFLARE_AGENT_ZONE_ID",
] as const
const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]))
afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})
for (const k of VARS) delete process.env[k]

const target = {
  providerSlug: "digitalocean",
  planCode: "s-2vcpu-4gb",
  regionCode: "fra1",
}

describe("poolKeyFor()", () => {
  it("names the target and what it is baked with", () => {
    expect(poolKeyFor({ ...target, runtime: "openclaw", webuiEnabled: false })).toBe(
      `digitalocean|s-2vcpu-4gb|fra1|openclaw|0|${OPENCLAW_PINNED_VERSION}@sovereignclaw.xyz`,
    )
    const universal = poolKeyFor({ ...target, runtime: "hermes", webuiEnabled: true })
    expect(universal.startsWith("digitalocean|s-2vcpu-4gb|fra1|universal|1|")).toBe(true)
    expect(universal).toContain(`hermes@${HERMES_PINNED_VERSION}+`)
    expect(universal).toContain(`+lite@${liteVersion()}@sovereignclaw.xyz`)
  })

  it("serves every chat-UI engine from the one universal pool, and OpenClaw from its own", () => {
    const keys = LITE_ENGINES.map((runtime) => poolKeyFor({ ...target, runtime, webuiEnabled: true }))
    expect(new Set(keys).size).toBe(1)
    expect(poolKeyFor({ ...target, runtime: "openclaw", webuiEnabled: false })).not.toBe(keys[0])
    // An engine deployed without its chat UI is not what a universal VM serves.
    expect(poolRuntimeFor("hermes", false)).toBe("hermes")
    expect(poolRuntimeFor("openclaw", true)).toBe("openclaw")
  })

  it("retires universal VMs when any engine's pin changes", () => {
    const before = poolKeyFor({ ...target, runtime: "codex", webuiEnabled: true })
    process.env.ATLAS_OPENCODE_VERSION = "1.19.3"
    expect(poolKeyFor({ ...target, runtime: "codex", webuiEnabled: true })).not.toBe(before)
  })

  // The stale-key reap is what retires old VMs, so a change that should
  // retire them must change the key.
  it("changes when a version pin changes", () => {
    const before = poolKeyFor({ ...target, runtime: "openclaw", webuiEnabled: false })
    process.env.OPENCLAW_VERSION = "2026.9.9"
    expect(poolKeyFor({ ...target, runtime: "openclaw", webuiEnabled: false })).not.toBe(before)
  })

  it("changes when new agents move to another zone", () => {
    const before = poolKeyFor({ ...target, runtime: "hermes", webuiEnabled: true })
    process.env.CLOUDFLARE_AGENT_DOMAIN = "atlasdeploy.xyz"
    process.env.CLOUDFLARE_AGENT_ZONE_ID = "zone-new"
    const after = poolKeyFor({ ...target, runtime: "hermes", webuiEnabled: true })
    expect(after).not.toBe(before)
    expect(after.endsWith("@atlasdeploy.xyz")).toBe(true)
  })

  it("leaves the sidecar out of a runtime that has none", () => {
    expect(bakeIdentity("openclaw", true)).toBe(`${OPENCLAW_PINNED_VERSION}@sovereignclaw.xyz`)
  })
})
