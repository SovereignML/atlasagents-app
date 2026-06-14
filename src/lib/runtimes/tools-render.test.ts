import { describe, it, expect } from "vitest"
import { openclawRuntime } from "@/lib/runtimes/openclaw"
import { hermesRuntime } from "@/lib/runtimes/hermes"

const base = {
  gatewayToken: "tok",
  openRouterApiKey: "k",
  model: "a/b",
  fallbackModel: "c/d",
  domain: null,
  managedSubdomain: "x.test",
  ipAddress: "1.2.3.4",
  tlsStatus: null,
}

describe("OpenClaw renderConfig — tools", () => {
  it("emits no browser/tools sections when nothing is enabled", () => {
    const out = openclawRuntime.renderConfig({ ...base })
    expect(out).not.toContain("browser")
    expect(out).not.toContain('"tools"')
  })

  it("is byte-identical for undefined vs empty enabledToolIds", () => {
    const a = openclawRuntime.renderConfig({ ...base })
    const b = openclawRuntime.renderConfig({ ...base, enabledToolIds: [] })
    expect(a).toBe(b)
  })

  it("renders browser + tools.alsoAllow when browser is enabled", () => {
    const out = openclawRuntime.renderConfig({ ...base, enabledToolIds: ["browser"] })
    expect(out).toContain('"enabled": true')
    expect(out).toContain('"cdpPort": 18800')
    // `color` is required by the gateway schema — its absence 502s the gateway.
    expect(out).toContain('"color": "#FF4500"')
    // Real Chrome .deb + no-sandbox so it launches headless under systemd.
    expect(out).toContain('"executablePath": "/usr/bin/google-chrome"')
    expect(out).toContain('"noSandbox": true')
    expect(out).toContain('"alsoAllow"')
    expect(out).toContain('"browser"')
  })

  it("ignores comingSoon catalog tools (no config drift)", () => {
    const empty = openclawRuntime.renderConfig({ ...base, enabledToolIds: [] })
    const coming = openclawRuntime.renderConfig({ ...base, enabledToolIds: ["web_search"] })
    expect(coming).toBe(empty)
  })
})

describe("Hermes renderInitScript — toolsets", () => {
  const initBase = {
    installDir: "/opt/hermes",
    systemUser: "hermes",
    cliBinary: "/opt/hermes/venv/bin/hermes",
    envPath: "/opt/hermes/.hermes/.env",
    provider: "openrouter" as const,
    model: "a/b",
    baseUrl: "https://x",
  }

  it("keeps only hermes-cli when no tools are enabled", () => {
    const out = hermesRuntime.renderInitScript!({ ...initBase })!
    expect(out).toContain(`config set toolsets '["hermes-cli"]'`)
    expect(out).not.toContain("browser.provider")
  })

  it("adds the browser toolset + provider when browser is enabled", () => {
    const out = hermesRuntime.renderInitScript!({
      ...initBase,
      enabledToolIds: ["browser"],
    })!
    expect(out).toContain(`["hermes-cli","browser"]`)
    expect(out).toContain("config set browser.provider local")
  })
})
