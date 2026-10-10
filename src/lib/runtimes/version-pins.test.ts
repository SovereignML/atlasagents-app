import { afterEach, describe, it, expect } from "vitest"
import { OPENCLAW_PINNED_VERSION, OPENCLAW_VERSION, openclawRuntime } from "./openclaw"
import {
  HERMES_PINNED_VERSION,
  HERMES_VERSION,
  OPEN_WEBUI_PINNED_VERSION,
  OPEN_WEBUI_VERSION,
  hermesRuntime,
} from "./hermes"
import { isPinned, isSafeVersion } from "@/lib/runtime-versions"

const VARS = ["OPENCLAW_VERSION", "HERMES_VERSION", "OPEN_WEBUI_VERSION"] as const
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
    for (const v of [OPENCLAW_PINNED_VERSION, HERMES_PINNED_VERSION, OPEN_WEBUI_PINNED_VERSION]) {
      expect(isPinned(v)).toBe(true)
      expect(isSafeVersion(v)).toBe(true)
    }
  })

  it("are what a box installs when nothing overrides them", () => {
    expect(OPENCLAW_VERSION()).toBe(OPENCLAW_PINNED_VERSION)
    expect(HERMES_VERSION()).toBe(HERMES_PINNED_VERSION)
    expect(OPEN_WEBUI_VERSION()).toBe(OPEN_WEBUI_PINNED_VERSION)

    expect(openclawRuntime.renderBootstrap({ gatewayPort: 18789 })).toContain(
      `RUNTIME_PKG_SPEC='openclaw@${OPENCLAW_PINNED_VERSION}'`,
    )
    const hermes = hermesRuntime.renderBootstrap({ gatewayPort: 8642, webuiEnabled: true })
    expect(hermes).toContain(`RUNTIME_PKG_SPEC='hermes-agent==${HERMES_PINNED_VERSION}'`)
    expect(hermes).toContain(`OPEN_WEBUI_PKG_SPEC='open-webui==${OPEN_WEBUI_PINNED_VERSION}'`)
  })

  // How a bad pin gets rolled back, or upstream tracked again, without a code deploy.
  it("yield to an operator override, including latest", () => {
    process.env.OPENCLAW_VERSION = "2026.8.35"
    process.env.HERMES_VERSION = "latest"
    process.env.OPEN_WEBUI_VERSION = "0.11.4"
    expect(OPENCLAW_VERSION()).toBe("2026.8.35")
    expect(HERMES_VERSION()).toBe("latest")
    expect(OPEN_WEBUI_VERSION()).toBe("0.11.4")
    expect(hermesRuntime.renderBootstrap({ gatewayPort: 8642, webuiEnabled: true })).toContain(
      "RUNTIME_PKG_SPEC='hermes-agent'",
    )
  })
})
