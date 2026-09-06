import { describe, it, expect } from "vitest"
import { hermesRuntime, HERMES_GATEWAY_PORT } from "./hermes"

/**
 * Regression guards for the Caddyfile renderer. All three cases below were live
 * bugs: the two domain routes drove this renderer without `upstreamPort` (which
 * silently dropped the Open WebUI route off the public host) and Hermes ignored
 * `domainUseInternalTls` entirely (which made the Bring-Your-Own-Cloudflare path
 * request a Let's Encrypt cert it could never get behind the CF proxy).
 */
describe("hermesRuntime.renderCaddyfile()", () => {
  const DOMAIN = "agent.example.com"
  const MANAGED = "bot-bold-fox.sovereignclaw.xyz"
  const SIDECAR_PORT = 8080
  const GATEWAY_PORT = 8642

  describe("custom domain + Open WebUI sidecar", () => {
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

    it("routes everything else to the Open WebUI sidecar", () => {
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

/**
 * Regression guard for a live bug: the Open WebUI sidecar shipped without
 * `DEFAULT_MODELS`, so the freshly seeded admin account opened a chat with no
 * model selected and the FIRST message went out with no model attached — which
 * read to users as "Hermes ignores my OpenRouter model", even though the gateway
 * itself was correctly pinned.
 */
describe("hermesRuntime.sidecar.renderEnv()", () => {
  const baseArgs = {
    instance: { id: "inst_1", domain: null } as never,
    gatewayToken: "gw-token",
    gatewayPort: HERMES_GATEWAY_PORT,
    secretKey: "sekrit",
    publicUrl: null,
    enableSignup: true,
    model: "deepseek/deepseek-v4-pro",
  }

  it("pre-selects the pinned model for new chats", () => {
    const env = hermesRuntime.sidecar!.renderEnv(baseArgs)
    expect(env.DEFAULT_MODELS).toBe("deepseek/deepseek-v4-pro")
  })

  it("forces env to win over Open WebUI's persisted config", () => {
    // Without this, DEFAULT_MODELS is read once on first launch, stored in the
    // sidecar's DB, and every later env change is ignored — which is exactly how
    // a warm-pool VM (sidecar booted at bake with no model) ends up permanently
    // without a default.
    const env = hermesRuntime.sidecar!.renderEnv(baseArgs)
    expect(env.ENABLE_PERSISTENT_CONFIG).toBe("false")
  })

  it("points the chat UI at the gateway with the bearer token as its key", () => {
    const env = hermesRuntime.sidecar!.renderEnv(baseArgs)
    expect(env.OPENAI_API_BASE_URL).toBe(`http://127.0.0.1:${HERMES_GATEWAY_PORT}/v1`)
    expect(env.OPENAI_API_KEY).toBe("gw-token")
  })

  it("omits DEFAULT_MODELS rather than writing it empty when no model is known", () => {
    // The warm-pool bake renders a placeholder env before any instance exists. An
    // empty value would leave Open WebUI parsing a blank model id.
    const env = hermesRuntime.sidecar!.renderEnv({ ...baseArgs, model: "" })
    expect(env.DEFAULT_MODELS).toBeUndefined()
  })

  it("trims whitespace so the id matches what /v1/models reports", () => {
    const env = hermesRuntime.sidecar!.renderEnv({ ...baseArgs, model: "  minimax/minimax-m2.5  " })
    expect(env.DEFAULT_MODELS).toBe("minimax/minimax-m2.5")
  })
})
