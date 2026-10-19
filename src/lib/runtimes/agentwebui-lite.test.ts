import crypto from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import {
  ACP_ADAPTERS,
  CHAT_UI_LITE,
  CHAT_UI_OPEN_WEBUI,
  LITE_PINNED_COMMIT,
  LITE_PORT,
  LITE_SETTING_KEYS,
  buildLiteEmbedUrl,
  chatUiOf,
  liteEmbedSecret,
  litePipSpec,
  liteVersion,
  platformChatUi,
  withChatUi,
} from "./agentwebui-lite"
import { getRuntime, runtimeForInstance } from "./index"
import { OPEN_WEBUI_PORT } from "./open-webui"
import { bakeIdentity } from "@/lib/warm-pool-key"

const VARS = ["CHAT_UI", "AGENTWEBUI_LITE_PIP_SPEC", "INSTANCE_ENCRYPTION_KEY"] as const
const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]))
afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const instance = { id: "inst_1", name: "Research bot", domain: null } as never
const envArgs = (extra: Record<string, unknown> = {}) => ({
  instance,
  gatewayToken: "tok",
  gatewayPort: 8642,
  secretKey: "e".repeat(64),
  publicUrl: "https://a.atlasdeploy.xyz",
  enableSignup: true,
  adminPassword: "pw",
  model: "anthropic/claude-sonnet-4.6",
  ...extra,
})

describe("choosing the chat UI", () => {
  it("is Open WebUI unless CHAT_UI asks for Lite", () => {
    delete process.env.CHAT_UI
    expect(platformChatUi()).toBe(CHAT_UI_OPEN_WEBUI)
    process.env.CHAT_UI = "agentwebui-lite"
    expect(platformChatUi()).toBe(CHAT_UI_LITE)
    process.env.CHAT_UI = "something-else"
    expect(platformChatUi()).toBe(CHAT_UI_OPEN_WEBUI)
  })

  it("reads an agent's own UI from its row, NULL meaning Open WebUI", () => {
    expect(chatUiOf({ chatUi: null })).toBe(CHAT_UI_OPEN_WEBUI)
    expect(chatUiOf({})).toBe(CHAT_UI_OPEN_WEBUI)
    expect(chatUiOf({ chatUi: "agentwebui-lite" })).toBe(CHAT_UI_LITE)
  })

  it("leaves Open WebUI agents and OpenClaw exactly as they were", () => {
    const hermes = getRuntime("hermes")
    expect(withChatUi(hermes, CHAT_UI_OPEN_WEBUI)).toBe(hermes)
    expect(runtimeForInstance({ runtime: "hermes", chatUi: null })).toBe(hermes)
    const openclaw = getRuntime("openclaw")
    expect(withChatUi(openclaw, CHAT_UI_LITE)).toBe(openclaw)
  })
})

describe("Lite as the sidecar", () => {
  it("takes Open WebUI's port, so Caddy routes it unchanged, and has no admin to seed", () => {
    const sidecar = runtimeForInstance({ runtime: "hermes", chatUi: CHAT_UI_LITE }).sidecar!
    expect(sidecar.serviceName).toBe("agentwebui-lite")
    expect(sidecar.port).toBe(OPEN_WEBUI_PORT)
    expect(sidecar.healthPath).toBe("/api/health")
    expect(sidecar.seedAdmin).toBeUndefined()
  })

  it("starts Hermes over ACP with the model and folder locked, framed only by the dashboard", () => {
    const sidecar = withChatUi(getRuntime("hermes"), CHAT_UI_LITE).sidecar!
    const env = sidecar.renderEnv(envArgs({ frameAncestors: ["https://app.atlasagents.dev", "nope"] }))
    expect(env).toMatchObject({
      HOST: "127.0.0.1",
      PORT: String(LITE_PORT),
      PASSWORD: "pw",
      EMBED_SECRET: "e".repeat(64),
      TRUST_PROXY: "true",
      LOCK_MODEL: "true",
      LOCK_FOLDER: "true",
      AGENT_HERMES_COMMAND: "/opt/hermes/venv/bin/hermes acp",
      AGENT_HERMES_NAME: "Research bot",
      FRAME_ANCESTORS: "https://app.atlasagents.dev",
    })
    expect(env.FILES_ROOTS).toBe(env.WORKSPACE_DIR)
    expect(env).not.toHaveProperty("PROVIDER_OPENROUTER_URL")
  })

  it("starts the CLI engines through their pinned ACP adapters", () => {
    const env = withChatUi(getRuntime("claude-code"), CHAT_UI_LITE).sidecar!.renderEnv(envArgs())
    expect(env.AGENT_CLAUDECODE_COMMAND).toBe("/opt/agentwebui-lite/acp/node_modules/.bin/claude-agent-acp")
    expect(env).not.toHaveProperty("FRAME_ANCESTORS")
  })

  it("runs as the engine's user with the engine's env, and keeps Lite's settings out of it", () => {
    const engine = getRuntime("codex")
    const sidecar = withChatUi(engine, CHAT_UI_LITE).sidecar!
    const unit = sidecar.renderSystemdUnit()
    expect(unit).toContain(`User=${engine.paths.systemUser}`)
    // Only the engine's files reach the environment the agents inherit...
    const files = [...unit.matchAll(/^EnvironmentFile=(.+)$/gm)].map((m) => m[1])
    expect(files).toEqual([engine.paths.envPath, `-${engine.paths.configPath}`])
    // ...and Lite reads its own (password, embed secret) from its .env.
    expect(unit).toContain(`Environment=AWL_ENV_FILE=${sidecar.envPath}`)
    expect(unit).toContain("ExecStart=/opt/agentwebui-lite/venv/bin/agentwebui-lite")
  })

  it("never lets an engine's env override a Lite setting", () => {
    for (const id of ["hermes", "claude-code", "codex"]) {
      const env = getRuntime(id).buildEnv({
        instance: { id: "i", domain: "a.example", name: "A" } as never,
        adminEmail: "a@b.c",
        adminPassword: "pw",
        gatewayToken: "tok",
        openRouterApiKey: "sk-or",
        baseUrl: undefined,
      } as never)
      expect(Object.keys(env).filter((k) => LITE_SETTING_KEYS.test(k))).toEqual([])
    }
  })
})

describe("installing Lite", () => {
  it("installs Lite and Hermes' ACP extra instead of Open WebUI", () => {
    const script = withChatUi(getRuntime("hermes"), CHAT_UI_LITE).renderBootstrap({
      gatewayPort: 8642,
      webuiEnabled: true,
      runtimeVersion: "0.19.0",
    })
    expect(script).toContain('step "install_agentwebui_lite"')
    expect(script).toContain("'hermes-agent[acp]==0.19.0'")
    expect(script).toContain(`git+https://github.com/HackersHostel/AgentWebUI-Lite@${LITE_PINNED_COMMIT}`)
    expect(script).not.toContain("OPEN_WEBUI_PKG_SPEC")
    expect(script).not.toContain("/opt/open-webui/venv")
  })

  it("installs the CLI engines' ACP adapter at its pin", () => {
    const script = withChatUi(getRuntime("codex"), CHAT_UI_LITE).renderBootstrap({ gatewayPort: 8650, webuiEnabled: true })
    expect(script).toContain(`'@agentclientprotocol/codex-acp@${ACP_ADAPTERS.codex.version}'`)
    expect(script).toContain('step "python_deps"')
    expect(script).not.toContain("OPEN_WEBUI_PKG_SPEC")
  })

  it("takes a pip requirement from AGENTWEBUI_LITE_PIP_SPEC, and names the version it installs", () => {
    delete process.env.AGENTWEBUI_LITE_PIP_SPEC
    expect(liteVersion()).toBe(`git-${LITE_PINNED_COMMIT.slice(0, 12)}`)
    process.env.AGENTWEBUI_LITE_PIP_SPEC = "agentwebui-lite==1.2.0"
    expect(litePipSpec()).toBe("agentwebui-lite==1.2.0")
    expect(liteVersion()).toBe("1.2.0")
  })

  it("keys the warm pool on the chat UI, so an agent only claims a VM with its own", () => {
    expect(bakeIdentity("hermes", true, CHAT_UI_LITE)).not.toBe(bakeIdentity("hermes", true, CHAT_UI_OPEN_WEBUI))
    expect(bakeIdentity("openclaw", false, CHAT_UI_LITE)).toBe(bakeIdentity("openclaw", false, CHAT_UI_OPEN_WEBUI))
  })
})

describe("signing the dashboard in", () => {
  it("derives a different, stable embed secret per agent", () => {
    process.env.INSTANCE_ENCRYPTION_KEY = "k".repeat(64)
    expect(liteEmbedSecret("a")).toBe(liteEmbedSecret("a"))
    expect(liteEmbedSecret("a")).not.toBe(liteEmbedSecret("b"))
    delete process.env.INSTANCE_ENCRYPTION_KEY
    expect(() => liteEmbedSecret("a")).toThrow(/INSTANCE_ENCRYPTION_KEY/)
  })

  it("makes a one-minute link in Lite's format: base64url claims, a dot, the hex HMAC", () => {
    const now = Date.UTC(2026, 9, 20)
    const url = new URL(buildLiteEmbedUrl("https://a.atlasdeploy.xyz/", "s".repeat(64), now))
    expect(url.origin + url.pathname).toBe("https://a.atlasdeploy.xyz/embed")
    const [text, signature] = url.searchParams.get("token")!.split(".")
    expect(signature).toBe(crypto.createHmac("sha256", "s".repeat(64)).update(text).digest("hex"))
    const claims = JSON.parse(Buffer.from(text, "base64url").toString("utf8"))
    expect(claims.exp).toBe(now / 1000 + 60)
    expect(claims.nonce).toMatch(/^[0-9a-f]{32}$/)
  })
})
