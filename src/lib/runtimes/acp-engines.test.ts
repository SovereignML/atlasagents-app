import { describe, expect, it } from "vitest"
import { getRuntime } from "./index"
import { OPENCODE_PINNED_VERSION, renderOpencodeConfig } from "./opencode"
import { PI_ACP_PINNED_VERSION, PI_PINNED_VERSION, renderPiSettings } from "./pi"
import { CODEX_MODEL_CATALOG, renderCodexConfigToml } from "./codex"
import { HERMES_ACP_PROVIDER_PATCH } from "./hermes-acp-patch"
import { buildLiteMigrationScript, liteSupports } from "./agentwebui-lite"
import { chatModels } from "./cli-runtime"

/**
 * OpenCode and Pi (driven over ACP), and what each engine is told so that the
 * chat UI's models (the admin-enabled ones) are ones its ACP server accepts.
 * The ids and config keys were checked against each engine's pinned release.
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
    model: "z-ai/glm-5.1",
    selectableModels: ["minimax/minimax-m2.5", "z-ai/glm-5.1"],
    baseUrl: "",
    enabledToolIds: [],
    ...extra,
  } as never
}
const envArgs = {
  instance: INSTANCE,
  gatewayToken: "t",
  gatewayPort: 1,
  enableSignup: true,
  adminEmail: "a@b.local",
  adminPassword: "pw",
  model: "z-ai/glm-5.1",
  selectableModels: ["minimax/minimax-m2.5"],
}

describe("OpenCode", () => {
  const rt = getRuntime("opencode")

  it("installs its pinned CLI and needs no gateway SDK: its CLI speaks ACP", () => {
    const boot = rt.renderBootstrap({ gatewayPort: rt.gatewayPort, webuiEnabled: true } as never)
    expect(boot).toContain(`opencode-ai@${OPENCODE_PINNED_VERSION}`)
    expect(boot).not.toMatch(/npm install --prefix '\/opt\/opencode\/gateway'/)
    expect(rt.buildEnv({ instance: INSTANCE, gatewayToken: "g", openRouterApiKey: "k", adminEmail: "", adminPassword: "" } as never))
      .toMatchObject({ ATLAS_ENGINE: "opencode", ATLAS_ACP_COMMAND: "/usr/bin/opencode acp", OPENROUTER_API_KEY: "k" })
  })

  it("is fronted by Lite through `opencode acp`, offering openrouter/<slug> models", () => {
    expect(liteSupports("opencode")).toBe(true)
    const env = rt.sidecar!.renderEnv(envArgs)
    expect(env.AGENT_OPENCODE_COMMAND).toBe("/usr/bin/opencode acp")
    expect(env.AGENT_OPENCODE_MODELS).toBe("openrouter/z-ai/glm-5.1,openrouter/minimax/minimax-m2.5")
  })

  it("writes opencode.json: OpenRouter only, the model, and the offered models as the whitelist", () => {
    const config = JSON.parse(renderOpencodeConfig({ model: "z-ai/glm-5.1", models: ["z-ai/glm-5.1", "minimax/minimax-m2.5"] }))
    expect(config).toMatchObject({
      model: "openrouter/z-ai/glm-5.1",
      enabled_providers: ["openrouter"],
      provider: { openrouter: { whitelist: ["z-ai/glm-5.1", "minimax/minimax-m2.5"] } },
      autoupdate: false,
    })
    const init = rt.renderInitScript!(initArgs("opencode"))!
    expect(decodedPayloads(init).some((p) => p.includes('"whitelist"'))).toBe(true)
  })
})

describe("Pi", () => {
  const rt = getRuntime("pi")

  it("installs its pinned CLI, and pi-acp next to the gateway, which drives Pi through it", () => {
    const boot = rt.renderBootstrap({ gatewayPort: rt.gatewayPort, webuiEnabled: true } as never)
    expect(boot).toContain(`@earendil-works/pi-coding-agent@${PI_PINNED_VERSION}`)
    expect(decodedPayloads(boot).some((p) => p.includes(`"pi-acp": "${PI_ACP_PINNED_VERSION}"`))).toBe(true)
    const env = rt.buildEnv({ instance: INSTANCE, gatewayToken: "g", openRouterApiKey: "k", adminEmail: "", adminPassword: "" } as never)
    expect(env.ATLAS_ACP_COMMAND).toBe("/opt/pi/gateway/node_modules/.bin/pi-acp")
    // pi-acp's "update available" line would land in replies.
    expect(env.npm_config_offline).toBe("true")
  })

  it("writes settings.json with OpenRouter, the model, and no startup banner", () => {
    expect(JSON.parse(renderPiSettings({ model: "z-ai/glm-5.1", models: [] }))).toEqual({
      defaultProvider: "openrouter",
      defaultModel: "z-ai/glm-5.1",
      enabledModels: ["openrouter/z-ai/glm-5.1"],
      quietStartup: true,
    })
    expect(rt.sidecar!.renderEnv(envArgs).AGENT_PI_COMMAND).toBe("/opt/agentwebui-lite/acp/node_modules/.bin/pi-acp")
  })
})

describe("the chat UI's models reach each engine", () => {
  it("lists the default first, once, and only for OpenRouter", () => {
    expect(chatModels({ provider: "openrouter", model: "a/x", selectableModels: ["b/y", "a/x"] })).toEqual(["a/x", "b/y"])
    expect(chatModels({ provider: "nvidia", model: "a/x", selectableModels: ["b/y"] })).toEqual([])
  })

  it("Claude Code: an availableModels allowlist in settings.json", () => {
    const init = getRuntime("claude-code").renderInitScript!(initArgs("claude-code"))
    expect(init).toContain(`ATLAS_MODELS='["z-ai/glm-5.1","minimax/minimax-m2.5"]'`)
    expect(init).toContain("j.availableModels = m")
  })

  it("Codex: a model catalog built from the installed Codex's own, named in config.toml", () => {
    const init = getRuntime("codex").renderInitScript!(initArgs("codex"))
    expect(init).toContain("debug models")
    expect(init).toContain(`ATLAS_OUT='${CODEX_MODEL_CATALOG}'`)
    expect(renderCodexConfigToml({ model: "m", workspaceDir: "/w", modelCatalog: CODEX_MODEL_CATALOG })).toMatch(
      /^model_catalog_json = "\/opt\/codex\/\.codex\/atlas-models\.json"$/m,
    )
    // No list (another provider): no catalog, and the old one is removed.
    const plain = getRuntime("codex").renderInitScript!(initArgs("codex", { provider: "nvidia" }))
    expect(plain).not.toContain("debug models")
    expect(plain).toContain(`rm -f '${CODEX_MODEL_CATALOG}'`)
  })

  it("Hermes: the provider patch is applied on install and when Lite is installed on an older box", () => {
    const hermes = getRuntime("hermes")
    const boot = hermes.renderBootstrap({ gatewayPort: hermes.gatewayPort, webuiEnabled: true } as never)
    expect(boot).toContain('step "patch_hermes_acp_provider"')
    expect(boot).toContain(HERMES_ACP_PROVIDER_PATCH.to)
    expect(buildLiteMigrationScript(hermes, { envB64: "" })).toContain('step "patch_hermes_acp_provider"')
  })
})

describe("the universal warm-pool image", () => {
  it("installs every chat-UI engine and Lite inside one framing, with each engine's account", async () => {
    const { LITE_ENGINES, renderUniversalBootstrap } = await import("./universal")
    const boot = renderUniversalBootstrap()
    expect(boot.match(/^#!\/bin\/bash/gm)).toHaveLength(1)
    for (const id of LITE_ENGINES) {
      const rt = getRuntime(id)
      expect(boot).toContain(`=== universal: ${id} ===`)
      expect(boot).toContain(`useradd --system --home-dir '${rt.paths.installDir}'`)
    }
    expect(boot).toContain('step "install_agentwebui_lite"')
    expect(boot).toContain('step "patch_hermes_acp_provider"')
    // DigitalOcean caps user-data at 64KB.
    expect(Buffer.byteLength(boot)).toBeLessThan(64 * 1024)
  })

  it("finalizes with Hermes' warm-up and enables no engine: the claim picks one", async () => {
    const { buildBakeFinalizeScript } = await import("./finalize")
    const script = buildBakeFinalizeScript("universal")
    expect(script).toContain("setup --non-interactive --quick")
    expect(script).not.toContain("systemctl enable")
  })
})
