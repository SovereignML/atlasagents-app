import { afterEach, describe, expect, it } from "vitest"
import crypto from "node:crypto"
import {
  CLAUDE_AGENT_SDK_PINNED_VERSION,
  CLAUDE_CODE_GATEWAY_PORT,
  CLAUDE_CODE_PINNED_VERSION,
  CLAUDE_WORKSPACE_MEMORY,
  claudeCodeRuntime,
} from "./claude-code"
import {
  CODEX_GATEWAY_PORT,
  CODEX_PINNED_VERSION,
  CODEX_SDK_PINNED_VERSION,
  codexRuntime,
  codexWireApi,
  renderCodexConfigToml,
} from "./codex"
import { CLI_GATEWAY_SOURCE } from "./cli-gateway"
import { CLI_TERMINAL_AUTH_PATH, CLI_TERMINAL_PORT, CLI_VPS_MIN_NODE } from "./cli-runtime"
import { hermesRuntime, HERMES_GATEWAY_PORT } from "./hermes"
import { OPENCLAW_VPS_MIN_NODE } from "./openclaw"
import { OPEN_WEBUI_PORT } from "./open-webui"
import { runtimeAcceptsModel, runtimeAvailableTo } from "./labels"
import { CLAUDE_CODE_MODELS, CODEX_MODELS, effectiveModel, isAllowedOpenRouterModel } from "@/lib/model-router"
import { availableRuntimesFor, runtimeDeployDenial } from "@/lib/runtime-access"

const ENGINES = [
  { rt: claudeCodeRuntime, port: CLAUDE_CODE_GATEWAY_PORT, cli: CLAUDE_CODE_PINNED_VERSION, sdk: CLAUDE_AGENT_SDK_PINNED_VERSION },
  { rt: codexRuntime, port: CODEX_GATEWAY_PORT, cli: CODEX_PINNED_VERSION, sdk: CODEX_SDK_PINNED_VERSION },
] as const

const INSTANCE = { id: "inst_1", domain: "agent.example.com", managedSubdomain: null } as never

/** Every base64 payload a script echoes, decoded. */
function decodedPayloads(script: string): string[] {
  return [...script.matchAll(/echo '([A-Za-z0-9+/=]+)' \| base64 -d/g)].map((m) =>
    Buffer.from(m[1], "base64").toString("utf8"),
  )
}

const ENV_VARS = [
  "CLI_RUNTIMES_ENABLED",
  "CODEX_WIRE_API",
  "CLAUDE_CODE_VERSION",
  "ATLAS_CLAUDE_CODE_VERSION",
  "CLAUDE_CODE_MODEL",
] as const
const saved = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]))
afterEach(() => {
  for (const k of ENV_VARS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe.each(ENGINES)("$rt.displayName engine", ({ rt, port, cli, sdk }) => {
  it("does not collide with any other loopback port on the box", () => {
    const taken = [HERMES_GATEWAY_PORT, OPEN_WEBUI_PORT, CLI_TERMINAL_PORT, 18789, 5678]
    expect(taken).not.toContain(port)
    expect(claudeCodeRuntime.gatewayPort).not.toBe(codexRuntime.gatewayPort)
  })

  it("asks for the same Node major as every other engine", () => {
    expect(rt.minNode).toBe(CLI_VPS_MIN_NODE)
    expect(rt.minNode.split(".")[0]).toBe(OPENCLAW_VPS_MIN_NODE.split(".")[0])
  })

  describe("renderCaddyfile()", () => {
    const out = rt.renderCaddyfile({ domain: "agent.example.com", upstreamPort: OPEN_WEBUI_PORT })

    it("guards /terminal with forward_auth against its own gateway", () => {
      expect(out).toContain("handle /terminal* {")
      expect(out).toContain(`forward_auth localhost:${port} {`)
      expect(out).toContain(`uri ${CLI_TERMINAL_AUTH_PATH}`)
      expect(out).toContain(`reverse_proxy localhost:${CLI_TERMINAL_PORT}`)
      // basic_auth's name and hash format differ between Caddy 2.6 and 2.11.
      expect(out).not.toMatch(/basic_?auth/)
    })

    it("routes /terminal ahead of /v1 and the chat UI catch-all", () => {
      const t = out.indexOf("handle /terminal*")
      const v1 = out.indexOf("handle /v1/*")
      expect(t).toBeGreaterThan(-1)
      expect(v1).toBeGreaterThan(t)
      expect(out).toContain(`reverse_proxy localhost:${port}`)
      expect(out).toContain(`reverse_proxy localhost:${OPEN_WEBUI_PORT}`)
    })

    it("keeps the terminal route even without the sidecar", () => {
      const single = rt.renderCaddyfile({ managedSubdomain: "x.sovereignclaw.xyz" })
      expect(single).toContain("handle /terminal*")
      expect(single).toMatch(/handle \{\s+reverse_proxy localhost:\d+/)
    })

    it("never exposes the gateway's terminal-auth endpoint publicly", () => {
      expect(out).not.toContain(`handle ${CLI_TERMINAL_AUTH_PATH}`)
    })
  })

  describe("buildEnv()", () => {
    const env = rt.buildEnv({
      instance: INSTANCE,
      adminEmail: "admin@x.local",
      adminPassword: "pw-123",
      gatewayToken: "gw-token",
      openRouterApiKey: "sk-or-key",
    })

    it("uses Hermes' API_SERVER_* names so the /v1/models check works unchanged", () => {
      expect(env).toMatchObject({
        API_SERVER_HOST: "127.0.0.1",
        API_SERVER_PORT: String(port),
        API_SERVER_KEY: "gw-token",
        ATLAS_ENGINE: rt.id,
        OPENROUTER_API_KEY: "sk-or-key",
        INSTANCE_ID: "inst_1",
      })
      expect(env.ATLAS_WORKSPACE).toBe(rt.paths.workspaceDir)
    })

    it("stores only a hash of the terminal password", () => {
      expect(env.TERMINAL_AUTH_USER).toBe("admin@x.local")
      expect(env.TERMINAL_AUTH_SHA256).toBe(crypto.createHash("sha256").update("pw-123").digest("hex"))
      expect(Object.values(env)).not.toContain("pw-123")
    })

    it("leaves the terminal locked when there are no credentials", () => {
      const bare = rt.buildEnv({
        instance: INSTANCE,
        adminEmail: "",
        adminPassword: "",
        gatewayToken: "t",
        openRouterApiKey: "k",
      })
      expect(bare.TERMINAL_AUTH_USER).toBeUndefined()
      expect(bare.TERMINAL_AUTH_SHA256).toBeUndefined()
    })
  })

  describe("renderBootstrap()", () => {
    const boot = rt.renderBootstrap({ gatewayPort: port, webuiEnabled: true })

    it("installs the pinned CLI strictly and the pinned SDK into the gateway dir", () => {
      expect(boot).toContain(`CLI_PKG_SPEC='${rt.npmPackage}@${cli}'`)
      expect(boot).toContain("--engine-strict")
      const pkg = decodedPayloads(boot).find((p) => p.includes("atlas-cli-gateway"))
      expect(pkg).toBeDefined()
      expect(JSON.parse(pkg!).dependencies).toEqual({ [rt.id === "codex" ? "@openai/codex-sdk" : "@anthropic-ai/claude-agent-sdk"]: sdk })
    })

    it("installs ttyd/tmux best-effort and Open WebUI when the sidecar is on", () => {
      expect(boot).toMatch(/apt-get \$APT_OPTS install -y tmux ttyd \|\| echo "WARNING/)
      expect(boot).toContain('step "install_open_webui"')
      expect(rt.renderBootstrap({ gatewayPort: port, webuiEnabled: false })).not.toContain("install_open_webui")
    })

    it("honours a resolved version pin", () => {
      expect(rt.renderBootstrap({ gatewayPort: port, runtimeVersion: "9.9.9" })).toContain(
        `CLI_PKG_SPEC='${rt.npmPackage}@9.9.9'`,
      )
    })
  })

  describe("renderInitScript()", () => {
    const script = rt.renderInitScript!({
      installDir: rt.paths.installDir,
      systemUser: rt.paths.systemUser,
      cliBinary: rt.cliBinary,
      envPath: rt.paths.envPath,
      provider: "openrouter",
      model: "vendor/model-x",
      baseUrl: "https://openrouter.ai/api/v1",
    })!
    const payloads = decodedPayloads(script)

    it("ships the exact gateway source on every run", () => {
      expect(payloads).toContain(CLI_GATEWAY_SOURCE)
    })

    it("pins the model for the gateway and the terminal", () => {
      const modelEnv = payloads.find((p) => p.startsWith("ATLAS_MODEL="))
      expect(modelEnv).toContain("ATLAS_MODEL=vendor/model-x\n")
    })

    it("fails fast when the bootstrap did not install the SDK", () => {
      expect(script).toContain("node_modules/")
      expect(script).toMatch(/exit 1/)
      expect(script.startsWith("#!/bin/bash\nset -euo pipefail")).toBe(true)
    })

    it("writes no secrets on a command line", () => {
      expect(script).not.toContain("sk-or")
      expect(script).not.toContain("API_SERVER_KEY")
    })
  })

  it("runs its terminal as the unprivileged system user, behind the gateway", () => {
    const unit = rt.terminal!.renderSystemdUnit()
    expect(unit).toContain(`User=${rt.paths.systemUser}`)
    expect(unit).toContain("--interface lo")
    expect(unit).toContain(`--port ${CLI_TERMINAL_PORT}`)
    expect(unit).toContain("--base-path /terminal")
    expect(unit).toContain("Environment=SHELL=/bin/bash")
    expect(rt.terminal!.healthPath).toBe("/terminal/")
  })

  it("starts the gateway with node from the root-owned gateway dir", () => {
    const unit = rt.renderSystemdUnit()
    expect(unit).toContain(`ExecStart=/usr/bin/node ${rt.paths.installDir}/gateway/gateway.mjs`)
    expect(unit).toContain(`EnvironmentFile=${rt.paths.envPath}`)
    expect(unit).toContain(`EnvironmentFile=-${rt.paths.configPath}`)
  })

  it("turns off Open WebUI's background task generation (each would be an agent run)", () => {
    const env = rt.sidecar!.renderEnv({
      instance: INSTANCE,
      gatewayToken: "t",
      gatewayPort: port,
      secretKey: "s",
      enableSignup: true,
      model: "m/x",
    })
    expect(env.ENABLE_TITLE_GENERATION).toBe("false")
    expect(env.ENABLE_FOLLOW_UP_GENERATION).toBe("false")
    expect(env.OPENAI_API_BASE_URL).toBe(`http://127.0.0.1:${port}/v1`)
    expect(rt.sidecar!.renderSystemdUnit()).toContain(`Wants=network-online.target ${rt.serviceName}.service`)
  })

  it("is beta, paid-only, and ships a sidecar plus terminal", () => {
    expect(rt.caps).toMatchObject({ beta: true, allowedOnFree: false, hasSidecar: true, hasTerminal: true, exposesOpenAiApi: true })
  })
})

describe("Claude Code specifics", () => {
  const env = claudeCodeRuntime.buildEnv({
    instance: INSTANCE,
    adminEmail: "a",
    adminPassword: "b",
    gatewayToken: "t",
    openRouterApiKey: "sk-or-key",
  })

  it("routes the CLI through OpenRouter's Anthropic endpoint on the instance key", () => {
    expect(env.ANTHROPIC_BASE_URL).toBe("https://openrouter.ai/api")
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-or-key")
    // Present-but-empty: a set ANTHROPIC_API_KEY would win and prompt.
    expect(env.ANTHROPIC_API_KEY).toBe("")
  })

  it("maps the CLI's model aliases onto allowlisted slugs", () => {
    for (const k of ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL"]) {
      expect(isAllowedOpenRouterModel(env[k])).toBe(true)
    }
  })

  it("imports the shared persona instead of duplicating it", () => {
    expect(CLAUDE_WORKSPACE_MEMORY).toContain("@AGENTS.md")
    const script = claudeCodeRuntime.renderInitScript!({
      installDir: "/opt/claude-code",
      systemUser: "claude-code",
      cliBinary: "/usr/bin/claude",
      envPath: "/e",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5.5",
      baseUrl: "",
    })!
    expect(decodedPayloads(script)).toContain(CLAUDE_WORKSPACE_MEMORY)
    expect(script).toContain("hasCompletedOnboarding")
    expect(decodedPayloads(script).find((p) => p.startsWith("ATLAS_MODEL="))).toContain(
      "ANTHROPIC_MODEL=anthropic/claude-sonnet-5.5",
    )
  })
})

describe("version pins", () => {
  it("ignores the CLAUDE_CODE_VERSION that Claude Code exports to child processes", () => {
    process.env.CLAUDE_CODE_VERSION = "2.1.296 (Claude Code)"
    delete process.env.ATLAS_CLAUDE_CODE_VERSION
    expect(claudeCodeRuntime.version()).toBe(CLAUDE_CODE_PINNED_VERSION)
  })

  it("takes a valid ATLAS_ override and rejects junk", () => {
    process.env.ATLAS_CLAUDE_CODE_VERSION = "2.2.0"
    expect(claudeCodeRuntime.version()).toBe("2.2.0")
    process.env.ATLAS_CLAUDE_CODE_VERSION = "latest"
    expect(claudeCodeRuntime.version()).toBe("latest")
    process.env.ATLAS_CLAUDE_CODE_VERSION = "1.0; rm -rf /"
    expect(claudeCodeRuntime.version()).toBe(CLAUDE_CODE_PINNED_VERSION)
  })
})

describe("Codex specifics", () => {
  it("configures OpenRouter as the model provider, keyed by env var", () => {
    const toml = renderCodexConfigToml({ model: "openai/gpt-5.3-codex", workspaceDir: "/opt/codex/.atlas/workspace" })
    expect(toml).toContain('model = "openai/gpt-5.3-codex"')
    expect(toml).toContain('model_provider = "openrouter"')
    expect(toml).toContain('env_key = "OPENROUTER_API_KEY"')
    expect(toml).toContain('[projects."/opt/codex/.atlas/workspace"]')
    expect(toml).not.toContain("sk-")
  })

  it("speaks the Responses API unless CODEX_WIRE_API=chat", () => {
    expect(codexWireApi()).toBe("responses")
    process.env.CODEX_WIRE_API = "chat"
    expect(codexWireApi()).toBe("chat")
    process.env.CODEX_WIRE_API = "nonsense"
    expect(codexWireApi()).toBe("responses")
  })

  it("points the SDK at the globally installed codex binary", () => {
    const env = codexRuntime.buildEnv({
      instance: INSTANCE,
      adminEmail: "",
      adminPassword: "",
      gatewayToken: "t",
      openRouterApiKey: "k",
    })
    expect(env.ATLAS_CODEX_BIN).toBe(codexRuntime.cliBinary)
    expect(env.CODEX_HOME).toBe("/opt/codex/.codex")
  })
})

describe("models", () => {
  it("ladders every tier onto an allowlisted model of the right family", () => {
    for (const slug of Object.values(CLAUDE_CODE_MODELS)) {
      expect(isAllowedOpenRouterModel(slug)).toBe(true)
      expect(runtimeAcceptsModel("claude-code", slug)).toBe(true)
    }
    for (const slug of Object.values(CODEX_MODELS)) {
      expect(isAllowedOpenRouterModel(slug)).toBe(true)
      expect(runtimeAcceptsModel("codex", slug)).toBe(true)
    }
  })

  it("pins each engine to its own ladder on OpenRouter", () => {
    const base = { llmProvider: "openrouter" as const, tier: "mid" as const, routedModel: "routed/x" }
    expect(effectiveModel({ ...base, runtimeId: "claude-code" })).toBe(CLAUDE_CODE_MODELS.mid)
    expect(effectiveModel({ ...base, runtimeId: "codex" })).toBe(CODEX_MODELS.mid)
    process.env.CLAUDE_CODE_MODEL = "anthropic/claude-opus-5.5"
    expect(effectiveModel({ ...base, runtimeId: "claude-code" })).toBe("anthropic/claude-opus-5.5")
  })

  it("keeps each engine to its own model family", () => {
    expect(runtimeAcceptsModel("claude-code", "openai/gpt-5.5")).toBe(false)
    expect(runtimeAcceptsModel("codex", "anthropic/claude-opus-5.5")).toBe(false)
    expect(runtimeAcceptsModel("hermes", "openai/gpt-5.5")).toBe(true)
  })
})

describe("beta access", () => {
  const admin = { user: { role: "admin" } }
  const customer = { user: { role: "user" } }

  it("hides the beta engines from customers until the flag is on", () => {
    delete process.env.CLI_RUNTIMES_ENABLED
    expect(availableRuntimesFor(customer)).toEqual(["openclaw", "hermes"])
    expect(runtimeDeployDenial("codex", customer)).toMatch(/not available/)
    expect(runtimeDeployDenial("hermes", customer)).toBeNull()
    process.env.CLI_RUNTIMES_ENABLED = "true"
    expect(availableRuntimesFor(customer)).toEqual(["openclaw", "hermes", "claude-code", "codex"])
    expect(runtimeDeployDenial("codex", customer)).toBeNull()
  })

  it("always lets platform admins dogfood them", () => {
    delete process.env.CLI_RUNTIMES_ENABLED
    expect(availableRuntimesFor(admin)).toContain("claude-code")
    expect(runtimeDeployDenial("claude-code", admin)).toBeNull()
  })

  it("rejects unknown runtime ids outright", () => {
    expect(runtimeAvailableTo("nope", { betaEnabled: true, isAdmin: true })).toBe(false)
  })
})

describe("Hermes is untouched by the CLI engines", () => {
  it("keeps Open WebUI's task generation on and has no terminal", () => {
    const env = hermesRuntime.sidecar!.renderEnv({
      instance: INSTANCE,
      gatewayToken: "t",
      gatewayPort: HERMES_GATEWAY_PORT,
      secretKey: "s",
      enableSignup: true,
      model: "m/x",
    })
    expect(env.ENABLE_TITLE_GENERATION).toBeUndefined()
    expect(hermesRuntime.terminal).toBeUndefined()
    expect(hermesRuntime.renderCaddyfile({ domain: "a.example.com", upstreamPort: 8080 })).not.toContain("/terminal")
  })
})
