import { afterEach, describe, it, expect } from "vitest"
import { bakeIdentity, poolKeyFor } from "./warm-pool-key"
import { OPENCLAW_PINNED_VERSION } from "./runtimes/openclaw"
import { HERMES_PINNED_VERSION, OPEN_WEBUI_PINNED_VERSION } from "./runtimes/hermes"

const VARS = [
  "OPENCLAW_VERSION",
  "HERMES_VERSION",
  "OPEN_WEBUI_VERSION",
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
    expect(poolKeyFor({ ...target, runtime: "hermes", webuiEnabled: true })).toBe(
      `digitalocean|s-2vcpu-4gb|fra1|hermes|1|${HERMES_PINNED_VERSION}+${OPEN_WEBUI_PINNED_VERSION}@sovereignclaw.xyz`,
    )
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
