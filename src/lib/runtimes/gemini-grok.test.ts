import { describe, expect, it } from "vitest"
import { getRuntime } from "./index"
import { acpCommand, liteModelId, liteSupports } from "./agentwebui-lite"
import { GEMINI_CLI_PINNED_VERSION, GEMINI_MODELS_PATH, renderGeminiSettings } from "./gemini-cli"
import { GROK_PINNED_VERSION, renderGrokConfig } from "./grok"
import { LITE_ENGINES, usesUniversalPool } from "./universal"
import { RUNTIME_CAPS, runtimeAcceptsModel } from "./labels"

/**
 * Gemini CLI and Grok: both speak ACP themselves, run on their vendor's models
 * through OpenRouter, and ship in the universal warm-pool image.
 */

/** Every base64 payload a script echoes, decoded. */
function decodedPayloads(script: string): string[] {
  return [...script.matchAll(/echo '([A-Za-z0-9+/=]+)' \| base64 -d/g)].map((m) =>
    Buffer.from(m[1], "base64").toString("utf8"),
  )
}

const INSTANCE = { id: "inst_1", domain: null, managedSubdomain: null } as never
const initArgs = (id: string, extra: Record<string, unknown> = {}) => {
  const rt = getRuntime(id)
  return {
    installDir: rt.paths.installDir,
    systemUser: rt.paths.systemUser,
    cliBinary: rt.cliBinary,
    envPath: rt.paths.envPath,
    provider: "openrouter",
    baseUrl: "",
    enabledToolIds: [],
    ...extra,
  } as never
}
const envArgs = (model: string, selectableModels: string[]) => ({
  instance: INSTANCE,
  gatewayToken: "t",
  gatewayPort: 1,
  enableSignup: true,
  adminEmail: "a@b.local",
  adminPassword: "pw",
  model,
  selectableModels,
})

describe("Gemini CLI", () => {
  const rt = getRuntime("gemini-cli")

  it("installs its pinned CLI and points it at the gateway's Gemini API with the gateway token", () => {
    const boot = rt.renderBootstrap({ gatewayPort: rt.gatewayPort, webuiEnabled: true } as never)
    expect(boot).toContain(`@google/gemini-cli@${GEMINI_CLI_PINNED_VERSION}`)
    expect(rt.buildEnv({ instance: INSTANCE, gatewayToken: "g", openRouterApiKey: "k", adminEmail: "", adminPassword: "" } as never)).toMatchObject({
      ATLAS_ENGINE: "gemini-cli",
      ATLAS_ACP_COMMAND: "/usr/bin/gemini --acp",
      GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${rt.gatewayPort}`,
      GEMINI_API_KEY: "g",
      API_SERVER_KEY: "g",
      OPENROUTER_API_KEY: "k",
      ATLAS_GEMINI_MODELS_PATH: GEMINI_MODELS_PATH,
    })
  })

  it("drives Google models only, named without google/ inside the CLI and in Lite", () => {
    expect(runtimeAcceptsModel("gemini-cli", "google/gemini-3.8-flash")).toBe(true)
    expect(runtimeAcceptsModel("gemini-cli", "x-ai/grok-4.7")).toBe(false)
    expect(liteModelId("gemini-cli", "google/gemini-4-argon")).toBe("gemini-4-argon")
    expect(liteSupports("gemini-cli")).toBe(true)
    expect(acpCommand(rt)).toBe("/usr/bin/gemini --acp")
    const env = rt.sidecar!.renderEnv(envArgs("google/gemini-3.8-flash", ["google/gemini-4-argon"]))
    expect(env.AGENT_GEMINICLI_MODELS).toBe("gemini-3.8-flash,gemini-4-argon")
  })

  it("writes settings with API-key auth, the model, no auto-update or telemetry, and the models list", () => {
    const settings = JSON.parse(renderGeminiSettings({ model: "google/gemini-3.8-flash" }))
    expect(settings).toMatchObject({
      security: { auth: { selectedType: "gemini-api-key" }, folderTrust: { enabled: false } },
      model: { name: "gemini-3.8-flash" },
      general: { enableAutoUpdate: false },
      privacy: { usageStatisticsEnabled: false },
      telemetry: { enabled: false },
    })
    expect(settings.context.fileName).toContain("AGENTS.md")
    const init = rt.renderInitScript!(
      initArgs("gemini-cli", { model: "google/gemini-3.8-flash", selectableModels: ["google/gemini-4-argon"] }),
    )
    const payloads = decodedPayloads(init ?? "")
    expect(payloads).toContain("google/gemini-3.8-flash\ngoogle/gemini-4-argon\n")
    expect(payloads.some((p) => p.includes("GEMINI_MODEL=gemini-3.8-flash"))).toBe(true)
  })
})

describe("Grok", () => {
  const rt = getRuntime("grok")

  it("installs its pinned CLI and runs `grok agent stdio` with updates and telemetry off", () => {
    const boot = rt.renderBootstrap({ gatewayPort: rt.gatewayPort, webuiEnabled: true } as never)
    expect(boot).toContain(`@xai-official/grok@${GROK_PINNED_VERSION}`)
    expect(rt.buildEnv({ instance: INSTANCE, gatewayToken: "g", openRouterApiKey: "k", adminEmail: "", adminPassword: "" } as never)).toMatchObject({
      ATLAS_ENGINE: "grok",
      ATLAS_ACP_COMMAND: "/usr/bin/grok agent stdio",
      GROK_DISABLE_AUTOUPDATER: "1",
      GROK_TELEMETRY_ENABLED: "false",
      OPENROUTER_API_KEY: "k",
    })
    expect(acpCommand(rt)).toBe("/usr/bin/grok agent stdio")
  })

  it("drives xAI models only, each routed to OpenRouter under its own name", () => {
    expect(runtimeAcceptsModel("grok", "x-ai/grok-4.7")).toBe(true)
    expect(runtimeAcceptsModel("grok", "openai/gpt-6.1-sol")).toBe(false)
    expect(liteModelId("grok", "x-ai/grok-4.7")).toBe("grok-4.7")
    const toml = renderGrokConfig({ model: "x-ai/grok-4.7", models: ["x-ai/grok-4.7", "x-ai/grok-build-0.1"] })
    expect(toml).toContain('default = "grok-4.7"')
    expect(toml).toContain('allowed_models = ["grok-4.7", "grok-build-0.1"]')
    expect(toml).toContain('[model."grok-build-0.1"]\nmodel = "x-ai/grok-build-0.1"')
    expect(toml).toContain('base_url = "https://openrouter.ai/api/v1"')
    expect(toml).toContain('env_key = "OPENROUTER_API_KEY"')
    // Titles, web search and the rest stay on the agent's model, not a built-in xAI name.
    for (const key of ["session_summary", "web_search", "image_description", "prompt_suggestion"]) {
      expect(toml).toContain(`${key} = "grok-4.7"`)
    }
    expect(toml).toContain("auto_update = false")
    expect(toml).toContain("telemetry = false")
  })
})

describe("both", () => {
  it("are on the Free plan and in the universal warm-pool image", () => {
    for (const id of ["gemini-cli", "grok"] as const) {
      expect(RUNTIME_CAPS[id].allowedOnFree).toBe(true)
      expect(LITE_ENGINES).toContain(id)
      expect(usesUniversalPool(id, true)).toBe(true)
    }
    expect(usesUniversalPool("openclaw", false)).toBe(false)
  })
})
