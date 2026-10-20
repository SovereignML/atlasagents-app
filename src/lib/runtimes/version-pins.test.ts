import { afterEach, describe, it, expect } from "vitest"
import { OPENCLAW_PINNED_VERSION, OPENCLAW_VERSION, openclawRuntime } from "./openclaw"
import { HERMES_PINNED_VERSION, HERMES_VERSION, hermesRuntime } from "./hermes"
import { ACP_ADAPTERS, LITE_PINNED_VERSION } from "./agentwebui-lite"
import { isPinned, isSafeVersion } from "@/lib/runtime-versions"

const VARS = ["OPENCLAW_VERSION", "HERMES_VERSION", "AGENTWEBUI_LITE_PIP_SPEC"] as const
const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]))
afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})
for (const k of VARS) delete process.env[k]

describe("runtime version pins", () => {
  it("are concrete, shell-safe versions — never latest", () => {
    const adapters = Object.values(ACP_ADAPTERS).map((a) => a.version)
    for (const v of [OPENCLAW_PINNED_VERSION, HERMES_PINNED_VERSION, LITE_PINNED_VERSION, ...adapters]) {
      expect(isPinned(v)).toBe(true)
      expect(isSafeVersion(v)).toBe(true)
    }
  })

  it("are what a box installs when nothing overrides them", () => {
    expect(OPENCLAW_VERSION()).toBe(OPENCLAW_PINNED_VERSION)
    expect(HERMES_VERSION()).toBe(HERMES_PINNED_VERSION)

    expect(openclawRuntime.renderBootstrap({ gatewayPort: 18789 })).toContain(
      `RUNTIME_PKG_SPEC='openclaw@${OPENCLAW_PINNED_VERSION}'`,
    )
    const hermes = hermesRuntime.renderBootstrap({ gatewayPort: 8642, webuiEnabled: true })
    expect(hermes).toContain(`RUNTIME_PKG_SPEC='hermes-agent[acp,messaging]==${HERMES_PINNED_VERSION}'`)
    expect(hermes).toContain(`'agentwebui-lite==${LITE_PINNED_VERSION}'`)
  })

  // How a bad pin gets rolled back, or upstream tracked again, without a code deploy.
  it("yield to an operator override, including latest", () => {
    process.env.OPENCLAW_VERSION = "2026.8.35"
    process.env.HERMES_VERSION = "latest"
    process.env.AGENTWEBUI_LITE_PIP_SPEC = "agentwebui-lite==1.2.0"
    expect(OPENCLAW_VERSION()).toBe("2026.8.35")
    expect(HERMES_VERSION()).toBe("latest")
    const hermes = hermesRuntime.renderBootstrap({ gatewayPort: 8642, webuiEnabled: true })
    expect(hermes).toContain("RUNTIME_PKG_SPEC='hermes-agent[acp,messaging]'")
    expect(hermes).toContain("'agentwebui-lite==1.2.0'")
  })
})
