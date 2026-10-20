import crypto from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import {
  ACP_ADAPTERS,
  LEGACY_OPEN_WEBUI_SERVICE,
  LITE_MIGRATED,
  LITE_PINNED_VERSION,
  LITE_PORT,
  LITE_SETTING_KEYS,
  buildLiteEmbedUrl,
  buildLiteMigrationScript,
  liteEmbedSecret,
  litePipSpec,
  liteVersion,
  runsLite,
} from "./agentwebui-lite"
import { getRuntime } from "./index"
import { bakeIdentity } from "@/lib/warm-pool-key"

const VARS = ["AGENTWEBUI_LITE_PIP_SPEC", "INSTANCE_ENCRYPTION_KEY"] as const
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

describe("which agents run Lite", () => {
  it("is every agent marked on its row; NULL is a box from before Lite", () => {
    expect(runsLite({ chatUi: "agentwebui-lite" })).toBe(true)
    expect(runsLite({ chatUi: null })).toBe(false)
    expect(runsLite({})).toBe(false)
  })

  it("is the chat UI of every engine that has one; OpenClaw keeps its own", () => {
    for (const id of ["hermes", "claude-code", "codex"]) {
      expect(getRuntime(id).sidecar?.serviceName).toBe("agentwebui-lite")
    }
    expect(getRuntime("openclaw").sidecar).toBeUndefined()
  })
})

describe("Lite as the sidecar", () => {
  it("listens where Caddy sends the chat page, and has no admin to seed", () => {
    const sidecar = getRuntime("hermes").sidecar!
    expect(sidecar.port).toBe(LITE_PORT)
    expect(sidecar.healthPath).toBe("/api/health")
    expect(sidecar.seedAdmin).toBeUndefined()
  })

  it("starts Hermes over ACP with the model and folder locked, framed only by the dashboard", () => {
    const env = getRuntime("hermes").sidecar!.renderEnv(
      envArgs({ frameAncestors: ["https://app.atlasagents.dev", "nope"] }),
    )
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
      ATLAS_PINNED_MODEL: "anthropic/claude-sonnet-4.6",
    })
    expect(env.FILES_ROOTS).toBe(env.WORKSPACE_DIR)
    expect(Object.keys(env).some((k) => k.startsWith("PROVIDER_"))).toBe(false)
  })

  it("starts the CLI engines through their pinned ACP adapters", () => {
    const env = getRuntime("claude-code").sidecar!.renderEnv(envArgs())
    expect(env.AGENT_CLAUDECODE_COMMAND).toBe("/opt/agentwebui-lite/acp/node_modules/.bin/claude-agent-acp")
    expect(env).not.toHaveProperty("FRAME_ANCESTORS")
  })

  it("runs as the engine's user with the engine's env, and keeps Lite's settings out of it", () => {
    const engine = getRuntime("codex")
    const sidecar = engine.sidecar!
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
  it("installs Hermes with its ACP extra and Lite, and no Open WebUI", () => {
    const script = getRuntime("hermes").renderBootstrap({
      gatewayPort: 8642,
      webuiEnabled: true,
      runtimeVersion: "0.19.0",
    })
    expect(script).toContain("RUNTIME_PKG_SPEC='hermes-agent[acp]==0.19.0'")
    expect(script).toContain('step "install_agentwebui_lite"')
    expect(script).toContain(`'agentwebui-lite==${LITE_PINNED_VERSION}'`)
    expect(script).not.toContain("git+") // a PyPI release: no clone, no git on the box
    expect(script).not.toContain("install_hermes_acp") // already in the one Hermes install
    expect(script).not.toContain("open-webui")
  })

  it("installs the CLI engines' ACP adapter at its pin", () => {
    const script = getRuntime("codex").renderBootstrap({ gatewayPort: 8650, webuiEnabled: true })
    expect(script).toContain(`'@agentclientprotocol/codex-acp@${ACP_ADAPTERS.codex.version}'`)
    expect(script).toContain('step "python_deps"')
    expect(script).not.toContain("open-webui")
  })

  it("takes a pip requirement from AGENTWEBUI_LITE_PIP_SPEC, and names the version it installs", () => {
    delete process.env.AGENTWEBUI_LITE_PIP_SPEC
    expect(liteVersion()).toBe(LITE_PINNED_VERSION)
    process.env.AGENTWEBUI_LITE_PIP_SPEC = "agentwebui-lite==1.2.0"
    expect(litePipSpec()).toBe("agentwebui-lite==1.2.0")
    expect(liteVersion()).toBe("1.2.0")
  })

  it("keys the warm pool on Lite's version, so Open WebUI pool VMs are retired", () => {
    expect(bakeIdentity("hermes", true)).toContain(`+${liteVersion()}@`)
  })
})

describe("moving a box from Open WebUI to Lite", () => {
  const engine = getRuntime("claude-code")
  const script = buildLiteMigrationScript(engine, { envB64: "ZW52" })

  it("installs Lite before touching Open WebUI, so a failed install leaves the old UI up", () => {
    const install = script.indexOf('step "install_agentwebui_lite"')
    const remove = script.indexOf('step "remove_open_webui"')
    expect(install).toBeGreaterThan(-1)
    expect(remove).toBeGreaterThan(install)
    expect(script).toContain("set -euo pipefail")
  })

  it("has its own Python setup, and Hermes' ACP extra for a Hermes box", () => {
    expect(script).toContain("venv_create() {")
    expect(buildLiteMigrationScript(getRuntime("hermes"), { envB64: "ZW52" })).toContain('step "install_hermes_acp"')
  })

  it("removes Open WebUI's unit, files, env and user, then starts Lite on its port", () => {
    expect(script).toContain(`systemctl disable --now ${LEGACY_OPEN_WEBUI_SERVICE}`)
    expect(script).toContain("rm -rf /opt/open-webui")
    expect(script).toContain(`rm -f '${engine.paths.envPath.replace(/\/[^/]+$/, "")}/open-webui.env'`)
    expect(script).toContain(`userdel ${LEGACY_OPEN_WEBUI_SERVICE}`)
    expect(script).toContain(`http://127.0.0.1:${LITE_PORT}/api/health`)
    expect(script).toContain(`echo ${LITE_MIGRATED}`)
  })

  it("writes Lite's env readable only by the engine's user", () => {
    expect(script).toContain(`echo 'ZW52' | base64 -d > '${engine.sidecar!.envPath}'`)
    expect(script).toContain(`chmod 600 '${engine.sidecar!.envPath}'`)
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
