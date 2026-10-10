import { buildGatewayAllowedOrigins } from "@/lib/instance-gateway-access"
import type { RenderCaddyfileArgs, ToolServiceRoute } from "./types"
import { renderToolServiceHandles, renderToolServiceSiteBody } from "./shared"

/**
 * The Caddyfile for engines that expose an OpenAI-compatible gateway, optionally
 * fronted by the Open WebUI sidecar (Hermes, Claude Code, Codex). Lifted out of
 * hermes.ts with the gateway port and extra `handle` blocks as parameters;
 * Hermes' rendered output is byte-identical.
 */

/**
 * Build a RE2-safe alternation regex that matches if Origin equals any of the
 * allowed values exactly. Used in the Caddy `header_regexp Origin <pattern>`
 * matcher — Caddy's `header` matcher only accepts one value, so multi-origin
 * matching has to go through `header_regexp`.
 */
function corsOriginRegex(origins: string[]): string {
  const escaped = origins.map((o) => o.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
  return `^(${escaped.join("|")})$`
}

/**
 * Site-block body for a single-upstream Caddyfile (legacy: webuiEnabled=false,
 * or any runtime without a sidecar). Matches today's `${corsBlock}  ${upstreamBlock}`
 * splice point — every line is indented 2 spaces relative to the surrounding site block.
 */
function buildSingleUpstreamBody(
  allowed: string[],
  upstreamPort: number,
  toolServices?: ToolServiceRoute[],
  extraHandles?: string,
): string {
  const cors =
    allowed.length > 0
      ? `  @cors_origin header_regexp Origin "${corsOriginRegex(allowed)}"
  @cors_preflight method OPTIONS
  header @cors_origin Access-Control-Allow-Origin {http.request.header.Origin}
  header @cors_origin Access-Control-Allow-Credentials true
  header @cors_origin Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  header @cors_origin Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With"
  header @cors_origin Vary Origin
  respond @cors_preflight 204
`
      : ""
  // Engine-owned handles (e.g. `/terminal*`) need `handle` blocks too, so the
  // bare upstream becomes a catch-all `handle` behind them.
  if (extraHandles) {
    return `${cors}  ${extraHandles}\n  ${renderToolServiceSiteBody(toolServices ?? [], upstreamPort, "  ")}`
  }
  // With companion services (e.g. n8n) the bare upstream becomes `handle`
  // blocks so `/n8n/*` routes ahead of the gateway catch-all; the site-scope
  // CORS block above still applies globally. Byte-identical when none.
  if (toolServices && toolServices.length > 0) {
    return `${cors}  ${renderToolServiceSiteBody(toolServices, upstreamPort, "  ")}`
  }
  return `${cors}  reverse_proxy localhost:${upstreamPort} {
    header_up Host {host}
    header_up X-Real-IP {remote_host}
  }`
}

/**
 * Site-block body that path-routes inside a single host:
 *   `/v1/*` → the gateway (loopback, bearer-token auth)
 *   everything else → Open WebUI sidecar (its own session auth)
 *
 * Uses Caddy's `handle` directive — NOT `handle_path` — so `/v1/chat/completions`
 * arrives at the gateway verbatim, not stripped to `/chat/completions`. `handle`
 * blocks are first-match, so order matters: the `/v1/*` block sits above the
 * catch-all.
 *
 * CORS rules live inside the `/v1/*` handler only — Open WebUI manages its
 * own headers and runs same-origin from the browser, so adding cross-origin
 * headers to its handler would break it.
 */
function buildDualRouteBody(
  allowed: string[],
  sidecarPort: number,
  gatewayPort: number,
  toolServices?: ToolServiceRoute[],
  extraHandles?: string,
): string {
  const cors =
    allowed.length > 0
      ? `    @cors_origin header_regexp Origin "${corsOriginRegex(allowed)}"
    @cors_preflight method OPTIONS
    header @cors_origin Access-Control-Allow-Origin {http.request.header.Origin}
    header @cors_origin Access-Control-Allow-Credentials true
    header @cors_origin Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    header @cors_origin Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With"
    header @cors_origin Vary Origin
    respond @cors_preflight 204
`
      : ""
  // Companion-service handles (e.g. `/n8n/*`) and engine handles (e.g.
  // `/terminal*`) go FIRST — `handle` is first-match, so they must sit above
  // `/v1/*` and the catch-all. Empty → no prefix.
  const toolHandles = renderToolServiceHandles(toolServices, "  ")
  const toolPrefix = toolHandles ? `  ${toolHandles}\n` : ""
  const extraPrefix = extraHandles ? `  ${extraHandles}\n` : ""
  return `${toolPrefix}${extraPrefix}  handle /v1/* {
${cors}    reverse_proxy localhost:${gatewayPort} {
      header_up Host {host}
      header_up X-Real-IP {remote_host}
    }
  }
  handle {
    reverse_proxy localhost:${sidecarPort} {
      header_up Host {host}
      header_up X-Real-IP {remote_host}
    }
  }`
}

export type GatewayCaddyOpts = {
  /** Loopback port of the engine's OpenAI-compatible gateway. */
  gatewayPort: number
  /**
   * Engine-owned `handle` blocks spliced ahead of `/v1/*` (first line unindented,
   * later lines at a 2-space base). Omitted → output identical to Hermes'.
   */
  extraHandles?: string
}

/**
 * Caddy reverse-proxy + CORS at the proxy layer. Matches the OpenClaw
 * renderer's domain-vs-managed topology so DNS/TLS handling stays identical.
 *
 * Two body shapes:
 *  - **Dual-route** (`upstreamPort` set, i.e. webuiEnabled=true): path-routes
 *    `/v1/*` to the gateway and everything else to Open WebUI on
 *    `upstreamPort`. One public host serves both the chat UI and the
 *    OpenAI-compatible API for external bots.
 *  - **Single-upstream** (`upstreamPort` undefined, i.e. legacy
 *    webuiEnabled=false rows): proxies the whole host to the gateway.
 *    Kept for back-compat — existing instances don't get surprise re-routed.
 */
export function renderGatewayCaddyfile(args: RenderCaddyfileArgs, opts: GatewayCaddyOpts): string {
  const allowed = buildGatewayAllowedOrigins({
    domain: args.domain,
    managedSubdomain: args.managedSubdomain,
    ipAddress: null,
    tlsStatus: null,
  })

  const body = args.upstreamPort
    ? buildDualRouteBody(allowed, args.upstreamPort, opts.gatewayPort, args.toolServices, opts.extraHandles)
    : buildSingleUpstreamBody(allowed, opts.gatewayPort, args.toolServices, opts.extraHandles)

  const port80 = `:80 {
${body}
}
`

  const domain = args.domain?.trim()
  if (domain) {
    // Behind the user's own Cloudflare proxy (orange-cloud): Cloudflare
    // terminates TLS at its edge and pulls from the origin over HTTPS without
    // validating the cert (zone SSL = "Full", not strict), so a self-signed
    // `tls internal` cert is accepted. ACME cannot work here — the HTTP-01
    // challenge never reaches the origin — so Let's Encrypt is not an option.
    // Keep :80 for Cloudflare's origin pull / Always-Use-HTTPS check.
    if (args.domainUseInternalTls) {
      return `${domain} {
  tls internal
${body}
}

${port80}`
    }
    // Direct (grey-cloud / non-Cloudflare) custom domain: Caddy
    // auto-provisions Let's Encrypt TLS.
    return `${domain} {
${body}
}
`
  }

  const managed = args.managedSubdomain?.trim()
  if (managed && args.useCfOriginTls) {
    return `{
  ocsp_stapling off
}

${managed} {
  tls /etc/caddy/cf/origin.pem /etc/caddy/cf/origin.key
${body}
}

${port80}`
  }
  if (managed) {
    return `${managed} {
  tls internal
${body}
}

${port80}`
  }
  return port80
}
