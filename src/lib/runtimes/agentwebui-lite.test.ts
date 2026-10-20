import { afterEach, describe, expect, it } from "vitest"
import {
  LITE_BRAND_NAME,
  LITE_USER_NAME,
  liteBrandLogo,
  ACP_ADAPTERS,
  LEGACY_OPEN_WEBUI_SERVICE,
  LITE_MIGRATED,
  LITE_PINNED_VERSION,
  LITE_PORT,
  LITE_SETTING_KEYS,
  buildLiteMigrationScript,
  buildOpenWebuiRemovalSteps,
  liteModelId,
  litePipSpec,
  liteVersion,
  runsLite,
} from "./agentwebui-lite"
import { getRuntime } from "./index"
import { bakeIdentity } from "@/lib/warm-pool-key"

const VARS = ["AGENTWEBUI_LITE_PIP_SPEC"] as const
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
  publicUrl: "https://a.atlasdeploy.xyz",
  enableSignup: true,
  adminEmail: "admin+inst_1@hermes.local",
  adminPassword: "pw",
  model: "anthropic/claude-sonnet-4.6",
  selectableModels: ["z-ai/glm-5.1", "anthropic/claude-sonnet-4.6"],
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

  it("starts Hermes over ACP behind the agent's email and password, offering the enabled models", () => {
    const env = getRuntime("hermes").sidecar!.renderEnv(envArgs())
    expect(env).toMatchObject({
      HOST: "127.0.0.1",
      PORT: String(LITE_PORT),
      LOGIN_EMAIL: "admin+inst_1@hermes.local",
      PASSWORD: "pw",
      TRUST_PROXY: "true",
      LOCK_MODEL: "false",
      LOCK_FOLDER: "true",
      AGENT_HERMES_COMMAND: "/opt/hermes/venv/bin/hermes acp",
      AGENT_HERMES_NAME: "Research bot",
      // Hermes keeps an OpenRouter model on OpenRouter only when it is named
      // with the provider; the default comes first and is not repeated.
      AGENT_HERMES_MODEL: "openrouter:anthropic/claude-sonnet-4.6",
      AGENT_HERMES_MODELS: "openrouter:anthropic/claude-sonnet-4.6,openrouter:z-ai/glm-5.1",
      ATLAS_PINNED_MODEL: "anthropic/claude-sonnet-4.6",
    })
    expect(env.FILES_ROOTS).toBe(env.WORKSPACE_DIR)
    expect(Object.keys(env).some((k) => k.startsWith("PROVIDER_"))).toBe(false)
    expect(env).not.toHaveProperty("EMBED_SECRET")
    expect(env).not.toHaveProperty("FRAME_ANCESTORS")
  })

  it("locks the model when no models are enabled (a provider other than OpenRouter)", () => {
    const env = getRuntime("codex").sidecar!.renderEnv(envArgs({ selectableModels: [] }))
    expect(env.LOCK_MODEL).toBe("true")
    expect(env).not.toHaveProperty("AGENT_CODEX_MODEL")
    expect(env).not.toHaveProperty("AGENT_CODEX_MODELS")
  })

  it("names models the way each engine's ACP server lists them", () => {
    expect(liteModelId("hermes", "z-ai/glm-5.1")).toBe("openrouter:z-ai/glm-5.1")
    expect(liteModelId("opencode", "z-ai/glm-5.1")).toBe("openrouter/z-ai/glm-5.1")
    expect(liteModelId("pi", "z-ai/glm-5.1")).toBe("openrouter/z-ai/glm-5.1")
    expect(liteModelId("claude-code", "z-ai/glm-5.1")).toBe("z-ai/glm-5.1")
    expect(liteModelId("codex", "z-ai/glm-5.1")).toBe("z-ai/glm-5.1")
  })

  it("writes no key Lite would read as a second agent or a provider", () => {
    // Lite's config.py takes every ^(PROVIDER|AGENT)_<ID>_<FIELD>$ key as an
    // agent or provider, and exits at start when one has no COMMAND/URL. A
    // stray AGENT_IDLE_MINUTES did exactly that on every deploy.
    for (const [id, agentKey] of [["hermes", "AGENT_HERMES"], ["claude-code", "AGENT_CLAUDECODE"], ["codex", "AGENT_CODEX"]]) {
      const env = getRuntime(id).sidecar!.renderEnv(envArgs())
      const parsed = Object.keys(env).filter((k) => /^(PROVIDER|AGENT)_[A-Z0-9]+_[A-Z]+$/.test(k))
      expect(parsed.every((k) => k.startsWith(`${agentKey}_`))).toBe(true)
      expect(env).toHaveProperty(`${agentKey}_COMMAND`)
    }
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
    // ...and Lite reads its own (sign-in email and password) from its .env.
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

describe("Lite's branding", () => {
  it("keeps the AgentWebUI name, calls the signed-in user Admin, and shows our logo", () => {
    const env = getRuntime("grok").sidecar!.renderEnv(envArgs())
    expect(env.BRAND_NAME).toBe(LITE_BRAND_NAME)
    expect(LITE_BRAND_NAME).toBe("AgentWebUI")
    expect(env.USER_NAME).toBe(LITE_USER_NAME)
    expect(LITE_USER_NAME).toBe("Admin")
  })

  it("points the logo at the dashboard's public mark, and only over https", () => {
    expect(liteBrandLogo("https://app.atlasagents.dev/")).toBe("https://app.atlasagents.dev/assets/icons/SovereignML-logo-white.svg")
    expect(liteBrandLogo("http://localhost:3000")).toBeUndefined()
  })
})

describe("installing Lite", () => {
  it("installs Hermes with its ACP extra and Lite, and no Open WebUI", () => {
    const script = getRuntime("hermes").renderBootstrap({
      gatewayPort: 8642,
      webuiEnabled: true,
      runtimeVersion: "0.19.0",
    })
    expect(script).toContain("RUNTIME_PKG_SPEC='hermes-agent[acp,messaging]==0.19.0'")
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
    expect(script).toContain(buildOpenWebuiRemovalSteps())
    expect(script).toContain(`http://127.0.0.1:${LITE_PORT}/api/health`)
    expect(script).toContain(`echo ${LITE_MIGRATED}`)
  })

  it("writes Lite's env readable only by the engine's user", () => {
    expect(script).toContain(`echo 'ZW52' | base64 -d > '${engine.sidecar!.envPath}'`)
    expect(script).toContain(`chmod 600 '${engine.sidecar!.envPath}'`)
  })
})

describe("removing Open WebUI from a box", () => {
  const steps = buildOpenWebuiRemovalSteps()

  it("removes its service, install, env files and user", () => {
    expect(steps).toContain(`systemctl disable --now ${LEGACY_OPEN_WEBUI_SERVICE}`)
    expect(steps).toContain(`rm -f /etc/systemd/system/${LEGACY_OPEN_WEBUI_SERVICE}.service`)
    expect(steps).toContain("rm -rf /opt/open-webui")
    // Wherever a runtime kept it: Hermes in .hermes/, the CLI engines in .atlas/.
    for (const id of ["hermes", "claude-code", "codex"]) {
      const dir = getRuntime(id).paths.envPath.replace(/\/[^/]+$/, "")
      const pattern = dir.replace(/^\/opt\/[^/]+/, "/opt/*")
      expect(steps).toContain(`${pattern}/open-webui.env`)
    }
    expect(steps).toContain(`userdel ${LEGACY_OPEN_WEBUI_SERVICE}`)
  })

  // It runs inside the provisioner's install script and the migration, on
  // boxes that may never have had Open WebUI: no line may fail the script.
  it("never fails, so it is safe on a box that never had Open WebUI", () => {
    for (const line of steps.split("\n")) {
      const safe = line.includes("|| true") || line.startsWith("rm -f ") || line.startsWith("rm -rf ") || line.startsWith("if id ")
      expect(safe, line).toBe(true)
    }
  })

  it("only deletes what Open WebUI owned", () => {
    expect(steps).not.toMatch(/rm -rf \/opt\/(?!open-webui\b)/)
    expect(steps).not.toMatch(/\/opt\/(hermes|claude-code|codex)\/(?!\.)/) // never a runtime's own files
  })
})

