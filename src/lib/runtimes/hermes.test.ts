import { describe, it, expect } from "vitest"
import {
  hermesRuntime,
  HERMES_GATEWAY_PORT,
  HERMES_PINNED_VERSION,
  HERMES_VPS_MIN_NODE,
} from "./hermes"
import { OPENCLAW_VPS_MIN_NODE } from "./openclaw"

/**
 * Regression guards for the Caddyfile renderer. All three cases below were live
 * bugs: the two domain routes drove this renderer without `upstreamPort` (which
 * silently dropped the chat UI route off the public host) and Hermes ignored
 * `domainUseInternalTls` entirely (which made the Bring-Your-Own-Cloudflare path
 * request a Let's Encrypt cert it could never get behind the CF proxy).
 */
describe("hermesRuntime.renderCaddyfile()", () => {
  const DOMAIN = "agent.example.com"
  const MANAGED = "bot-bold-fox.sovereignclaw.xyz"
  const SIDECAR_PORT = 8080
  const GATEWAY_PORT = 8642

  describe("custom domain + chat UI sidecar", () => {
    const out = hermesRuntime.renderCaddyfile({
      domain: DOMAIN,
      upstreamPort: SIDECAR_PORT,
    })

    it("serves the site block for the custom domain", () => {
      expect(out).toContain(`${DOMAIN} {`)
    })

    it("path-routes /v1/* to the Hermes gateway", () => {
      expect(out).toContain("handle /v1/*")
      expect(out).toContain(`reverse_proxy localhost:${GATEWAY_PORT}`)
    })

    it("routes everything else to the chat UI sidecar", () => {
      // Without this the whole public host proxies to the bearer-token-only
      // gateway and the chat UI disappears the moment a domain is set.
      expect(out).toContain(`reverse_proxy localhost:${SIDECAR_PORT}`)
    })
  })

  describe("custom domain behind the user's Cloudflare (orange-cloud)", () => {
    const out = hermesRuntime.renderCaddyfile({
      domain: DOMAIN,
      domainUseInternalTls: true,
      upstreamPort: SIDECAR_PORT,
    })

    it("serves a self-signed cert instead of attempting ACME", () => {
      // ACME's HTTP-01 challenge cannot complete behind the CF edge; Cloudflare
      // in "Full" (non-strict) SSL mode accepts a self-signed origin cert.
      expect(out).toContain("tls internal")
    })

    it("keeps a :80 block for Cloudflare's origin pull", () => {
      expect(out).toContain(":80 {")
    })

    it("still dual-routes the API and the chat UI", () => {
      expect(out).toContain("handle /v1/*")
      expect(out).toContain(`reverse_proxy localhost:${SIDECAR_PORT}`)
    })
  })

  describe("custom domain, direct (grey-cloud)", () => {
    const out = hermesRuntime.renderCaddyfile({ domain: DOMAIN })

    it("emits no tls directive so Caddy auto-provisions Let's Encrypt", () => {
      expect(out).not.toContain("tls internal")
      expect(out).not.toContain("tls /etc/caddy")
    })

    it("proxies the whole host to the gateway when there is no sidecar", () => {
      expect(out).toContain(`reverse_proxy localhost:${GATEWAY_PORT}`)
      expect(out).not.toContain("handle /v1/*")
    })
  })

  describe("managed subdomain (no custom domain)", () => {
    it("uses the baked Cloudflare origin cert when one is present", () => {
      const out = hermesRuntime.renderCaddyfile({
        managedSubdomain: MANAGED,
        useCfOriginTls: true,
        upstreamPort: SIDECAR_PORT,
      })
      expect(out).toContain(`${MANAGED} {`)
      expect(out).toContain("tls /etc/caddy/cf/origin.pem /etc/caddy/cf/origin.key")
      expect(out).toContain("ocsp_stapling off")
      expect(out).toContain(":80 {")
    })

    it("falls back to a self-signed cert when no origin cert is baked in", () => {
      const out = hermesRuntime.renderCaddyfile({
        managedSubdomain: MANAGED,
        useCfOriginTls: false,
      })
      expect(out).toContain("tls internal")
      expect(out).not.toContain("/etc/caddy/cf/origin.pem")
    })

    it("is superseded by a custom domain when both are set", () => {
      const out = hermesRuntime.renderCaddyfile({
        domain: DOMAIN,
        managedSubdomain: MANAGED,
      })
      expect(out).toContain(`${DOMAIN} {`)
      expect(out).not.toContain(`${MANAGED} {`)
    })
  })

  it("serves plain :80 when neither a domain nor a managed subdomain is set", () => {
    const out = hermesRuntime.renderCaddyfile({})
    expect(out).toContain(":80 {")
    expect(out).not.toContain("tls")
  })
})

/** The chat UI (AgentWebUI Lite) drives Hermes over ACP, offering the models an admin enabled. */
describe("hermesRuntime.sidecar.renderEnv()", () => {
  const baseArgs = {
    instance: { id: "inst_1", domain: null, name: "Helper" } as never,
    gatewayToken: "gw-token",
    gatewayPort: HERMES_GATEWAY_PORT,
    publicUrl: null,
    enableSignup: true,
    adminEmail: "admin+inst_1@hermes.local",
    adminPassword: "pw",
    model: "deepseek/deepseek-v4-pro",
  }

  it("starts `hermes acp` in the agent's workspace, with the folder locked, behind the agent's login", () => {
    const env = hermesRuntime.sidecar!.renderEnv(baseArgs)
    expect(env.AGENT_HERMES_COMMAND).toBe("/opt/hermes/venv/bin/hermes acp")
    expect(env.WORKSPACE_DIR).toBe(hermesRuntime.paths.workspaceDir)
    expect(env.LOCK_FOLDER).toBe("true")
    expect(env.LOGIN_EMAIL).toBe("admin+inst_1@hermes.local")
    expect(env.PASSWORD).toBe("pw")
  })

  it("offers the enabled models by their openrouter: ids, and locks the model when there are none", () => {
    const env = hermesRuntime.sidecar!.renderEnv({ ...baseArgs, selectableModels: ["z-ai/glm-5.1"] })
    expect(env.LOCK_MODEL).toBe("false")
    expect(env.AGENT_HERMES_MODELS).toBe("openrouter:deepseek/deepseek-v4-pro,openrouter:z-ai/glm-5.1")
    expect(hermesRuntime.sidecar!.renderEnv(baseArgs).LOCK_MODEL).toBe("true")
  })

  it("records the pinned model, trimmed, so a reprovision can tell it moved", () => {
    const env = hermesRuntime.sidecar!.renderEnv({ ...baseArgs, model: "  minimax/minimax-m2.5  " })
    expect(env.ATLAS_PINNED_MODEL).toBe("minimax/minimax-m2.5")
    expect(hermesRuntime.sidecar!.renderEnv({ ...baseArgs, model: "" }).ATLAS_PINNED_MODEL).toBeUndefined()
  })
})

describe("Hermes bootstrap — Node floor and browser dependencies", () => {
  const render = (over: Record<string, unknown> = {}) =>
    hermesRuntime.renderBootstrap({
      gatewayPort: hermesRuntime.gatewayPort,
      webuiEnabled: true,
      ...over,
    })

  // `agent-browser` is installed globally on every Hermes box for the browser
  // tool and declares `engines.node: >=24.0.0` in every published version.
  // With the floor at 22.14.0 the bootstrap handed it Node 22 and — because
  // that install carries no `--engine-strict` — npm merely warned. Matching
  // OpenClaw's floor also means one Node major serves both runtimes, so a
  // prebaked box is never dragged between them.
  it("requires a Node new enough for agent-browser", () => {
    const major = Number.parseInt(HERMES_VPS_MIN_NODE.split(".")[0] ?? "", 10)
    expect(major).toBeGreaterThanOrEqual(24)
  })

  it("asks for the same Node major as OpenClaw", () => {
    expect(HERMES_VPS_MIN_NODE.split(".")[0]).toBe(
      OPENCLAW_VPS_MIN_NODE.split(".")[0],
    )
  })

  it("omits Chrome and agent-browser when no enabled tool needs them", () => {
    const script = render({ browserDeps: false })
    expect(script).not.toContain("google-chrome-stable")
    expect(script).not.toContain("agent-browser")
  })

  it("installs both when a tool does need them", () => {
    const script = render({ browserDeps: true })
    expect(script).toContain("google-chrome-stable")
    expect(script).toContain("agent-browser")
  })

  it("defaults to installing them when the flag is omitted", () => {
    expect(render()).toContain("google-chrome-stable")
  })

  // Whatever happens to the browser deps, the runtime install must not move.
  it("still installs hermes and the chat UI either way", () => {
    for (const script of [render({ browserDeps: false }), render({ browserDeps: true })]) {
      expect(script).toContain("verify_hermes_cli")
      expect(script).toContain("verify_agentwebui_lite")
      expect(script).not.toContain("open-webui")
    }
  })
})

describe("Hermes bootstrap — version pinning", () => {
  it("pins the runtime, with its ACP and messaging extras, when resolved", () => {
    const script = hermesRuntime.renderBootstrap({
      gatewayPort: hermesRuntime.gatewayPort,
      webuiEnabled: true,
      runtimeVersion: "0.19.0",
    })
    expect(script).toContain("RUNTIME_PKG_SPEC='hermes-agent[acp,messaging]==0.19.0'")
    // aiohttp (from `messaging`) is what lets the gateway serve /v1 on :8642.
    expect(script).toContain(`'/opt/hermes/venv/bin/python' -c 'import aiohttp'`)
  })

  // No resolved pin means the code pins, not a bare dist name (which is how
  // pip spells "latest").
  it("falls back to the code pins with no resolved pin", () => {
    const script = hermesRuntime.renderBootstrap({
      gatewayPort: hermesRuntime.gatewayPort,
      webuiEnabled: true,
    })
    expect(script).toContain(`RUNTIME_PKG_SPEC='hermes-agent[acp,messaging]==${HERMES_PINNED_VERSION}'`)
  })
})

describe("Hermes bootstrap — Python install strategy", () => {
  const render = (webuiEnabled: boolean) =>
    hermesRuntime.renderBootstrap({
      gatewayPort: hermesRuntime.gatewayPort,
      webuiEnabled,
    })

  // uv is an accelerator, never a new hard dependency: if astral.sh is
  // unreachable the bootstrap must still complete on pip. Trading a slow
  // provision for a broken one is not an optimization.
  it("uses uv when present and falls back to pip when not", () => {
    const script = render(true)
    expect(script).toContain("uv pip install")
    expect(script).toContain("astral.sh/uv/install.sh")
    expect(script).toContain("falling back to pip")
    // The fallback branch must still install via the venv's own pip.
    expect(script).toContain('"$venv/bin/pip" install --upgrade "$spec"')
  })

  it("installs Hermes and the chat UI into separate venvs with separate caches", () => {
    const script = render(true)
    expect(script).toContain("/var/tmp/py-cache-hermes")
    expect(script).toContain("/var/tmp/py-cache-awl")
    expect(script).toContain("venv_create '/opt/agentwebui-lite/venv'")
  })

  // hermes-agent's requires_python is >=3.11,<3.14; the chat UI has no lower
  // ceiling, so Hermes' is the one that applies, with or without it.
  it("enforces Hermes' Python ceiling", () => {
    for (const script of [render(true), render(false)]) {
      expect(script).toContain("sys.version_info[:2] < (3, 14)")
    }
  })

  it("still enforces the floor", () => {
    for (const script of [render(true), render(false)]) {
      expect(script).toContain("(3, 11) <= sys.version_info[:2]")
    }
  })
})

/**
 * `/v1/models` is what API clients see of the model list. Unconfigured, Hermes
 * advertises just `hermes-agent` instead of the model's real slug, and offers
 * nothing else to switch to.
 */
describe("hermesRuntime.renderInitScript() api_server models", () => {
  const base = {
    installDir: "/opt/hermes",
    systemUser: "hermes",
    cliBinary: "/opt/hermes/venv/bin/hermes",
    envPath: "/opt/hermes/.hermes/.env",
    model: "minimax/minimax-m2.5",
    baseUrl: "https://openrouter.ai/api/v1",
  }
  const spec = (script: string) => {
    const m = script.match(/HERMES_API_MODELS='([^']*)'/)
    expect(m).not.toBeNull()
    return JSON.parse(m![1]) as { default: string; provider: string; routes: string[] }
  }

  it("advertises the default under its slug and routes every other selectable model", () => {
    const script = hermesRuntime.renderInitScript!({
      ...base,
      provider: "openrouter",
      selectableModels: ["minimax/minimax-m2.5", "z-ai/glm-5.1", "openai/gpt-5.5", "z-ai/glm-5.1"],
    })!
    expect(spec(script)).toEqual({
      default: "minimax/minimax-m2.5",
      provider: "openrouter",
      routes: ["z-ai/glm-5.1", "openai/gpt-5.5"],
    })
    expect(script).toContain("'/opt/hermes/venv/bin/python' - <<'PY'")
    expect(script).toContain('extra["model_name"] = spec["default"]')
  })

  it("lists only the default for a non-OpenRouter provider", () => {
    const script = hermesRuntime.renderInitScript!({
      ...base,
      provider: "nvidia",
      selectableModels: ["z-ai/glm-5.1"],
    })!
    expect(spec(script).routes).toEqual([])
    expect(spec(script).default).toBe("minimax/minimax-m2.5")
  })

  it("does not fail the provision when the write fails", () => {
    const script = hermesRuntime.renderInitScript!({ ...base, provider: "openrouter" })!
    expect(script).toMatch(/<<'PY' \|\| echo "warn: could not write api_server model routes"/)
  })
})
