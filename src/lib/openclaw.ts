import crypto from "node:crypto"
import type { InferSelectModel } from "drizzle-orm"
import { instances } from "@/db"
import { buildGatewayAllowedOrigins } from "@/lib/instance-gateway-access"
import { routeModel } from "@/lib/model-router"

type Instance = InferSelectModel<typeof instances>
import type { BudgetTier } from "@/lib/agent-config"

const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

export function generateAdminPassword(length = 24): string {
  let out = ""
  const bytes = crypto.randomBytes(length)
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length]
  }
  return out
}

export function generateGatewayToken(length = 32): string {
  return crypto.randomBytes(length).toString("hex")
}

export const OPENCLAW_VERSION = () =>
  process.env.OPENCLAW_VERSION || "latest"

/** Minimum Node on VPS; must satisfy OpenClaw CLI / package engines (bootstrap verifies). */
export const OPENCLAW_VPS_MIN_NODE = "22.14.0"

export const OPENCLAW_GATEWAY_PORT = 18789
export const OPENCLAW_SERVICE_NAME = "openclaw-gateway"

export type OpenclawEnv = Record<string, string>

export function buildOpenclawEnv(args: {
  instance: Instance
  adminEmail: string
  adminPassword: string
  openRouterApiKey: string
}): OpenclawEnv {
  const tier = (args.instance.modelTier ?? "mid") as BudgetTier
  const route = routeModel(tier)

  const env: OpenclawEnv = {
    PORT: String(OPENCLAW_GATEWAY_PORT),
    DOMAIN: args.instance.domain ?? "",
    OPENROUTER_API_KEY: args.openRouterApiKey,
    OPENCLAW_ADMIN_EMAIL: args.adminEmail,
    OPENCLAW_ADMIN_PASSWORD: args.adminPassword,
    OPENCLAW_MODEL: route.model,
    OPENCLAW_FALLBACK_MODEL: route.fallback,
    OPENCLAW_LLM_PROVIDER: "openrouter",
    OPENCLAW_LLM_BASE_URL: "https://openrouter.ai/api/v1",
    INSTANCE_ID: args.instance.id,
  }

  if (route.fallbackProvider) {
    env.NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || ""
    env.OPENCLAW_FALLBACK_BASE_URL = route.fallbackProvider.baseUrl
    env.OPENCLAW_FALLBACK_MODEL = route.fallbackProvider.model
  }

  return env
}

/**
 * Generate OpenClaw Gateway openclaw.json config.
 * Uses the current schema: bind modes (not IPs), agents.defaults.model
 * with primary/fallbacks, and agent list entries with `id`.
 * OpenRouter API key is passed via env var (in .env), not in config.
 *
 * Gateway uses bind mode `loopback` (Caddy on the same host proxies all external
 * traffic to 127.0.0.1). trustedProxies is 127.0.0.1 so OpenClaw honours headers from
 * Caddy. Both auth.token and remote.token must match for token validation.
 */
export function renderOpenclawConfig(args: {
  gatewayToken: string
  openRouterApiKey: string
  model: string
  fallbackModel: string
  domain?: string | null
  managedSubdomain?: string | null
  ipAddress?: string | null
  tlsStatus?: string | null
  soulMd?: string | null
}): string {
  let allowedOrigins = buildGatewayAllowedOrigins({
    domain: args.domain,
    managedSubdomain: args.managedSubdomain,
    ipAddress: args.ipAddress,
    tlsStatus: args.domain ? args.tlsStatus : null,
  })
  if (allowedOrigins.length === 0) {
    allowedOrigins = [`http://localhost:${OPENCLAW_GATEWAY_PORT}`]
  }

  const config = {
    gateway: {
      mode: "local",
      port: OPENCLAW_GATEWAY_PORT,
      bind: "loopback",
      auth: { mode: "token" as const, token: args.gatewayToken },
      trustedProxies: ["127.0.0.1"],
      controlUi: {
        allowedOrigins,
        dangerouslyDisableDeviceAuth: true,
      },
    },
    agents: {
      defaults: {
        model: {
          primary: args.model,
          fallbacks: [args.fallbackModel],
        },
      },
      list: [{ id: "main" }],
    },
  }

  return JSON.stringify(config, null, 2) + "\n"
}

/**
 * Caddy reverse-proxies to the OpenClaw Gateway on loopback.
 * With a domain, Caddy auto-provisions Let's Encrypt TLS.
 * Without a domain, Caddy serves HTTP on :80.
 *
 * Headers forwarded to OpenClaw:
 *  - Host (original request host, required for multi-tenant routing)
 *  - X-Real-IP (real client IP for audit/rate-limiting)
 *  - X-Forwarded-For / X-Forwarded-Proto / Authorization are passed by Caddy automatically
 */
export type RenderCaddyfileArgs = {
  domain?: string | null
  managedSubdomain?: string | null
  /** When true, emit TLS for managed host using certs at /etc/caddy/cf/ (bootstrap). */
  useCfOriginTls?: boolean
}

export function renderCaddyfile(args: RenderCaddyfileArgs): string {
  const upstreamBlock = `reverse_proxy localhost:${OPENCLAW_GATEWAY_PORT} {
    header_up Host {host}
    header_up X-Real-IP {remote_host}
  }`

  const domain = args.domain?.trim()
  if (domain) {
    return `${domain} {
  ${upstreamBlock}
}
`
  }

  const port80 = `:80 {
  ${upstreamBlock}
}
`
  const managed = args.managedSubdomain?.trim()
  if (managed && args.useCfOriginTls) {
    return `{
  ocsp_stapling off
}

${managed} {
  tls /etc/caddy/cf/origin.pem /etc/caddy/cf/origin.key
  ${upstreamBlock}
}

${port80}`
  }

  // Cloudflare-proxied managed subdomains hit the origin on :443 by default
  // (SSL mode "Full" / "Full strict"). Without a public cert on the origin we
  // must still terminate TLS — `tls internal` makes Caddy generate a
  // self-signed cert that Cloudflare accepts in "Full" mode. Without this,
  // Caddy only listens on :80 and Cloudflare returns 521.
  if (managed) {
    return `${managed} {
  tls internal
  ${upstreamBlock}
}

${port80}`
  }

  return port80
}

/**
 * systemd unit for the OpenClaw Gateway daemon.
 * Runs as the dedicated `openclaw` user created during SSH bootstrap.
 */
export function renderSystemdUnit(): string {
  return `[Unit]
Description=OpenClaw Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=openclaw
Group=openclaw
WorkingDirectory=/opt/openclaw
EnvironmentFile=/opt/openclaw/.env
Environment=NODE_COMPILE_CACHE=/var/tmp/openclaw-compile-cache
Environment=OPENCLAW_NO_RESPAWN=1
Environment=HOME=/opt/openclaw
ExecStart=/usr/bin/openclaw gateway --allow-unconfigured
Restart=always
RestartSec=2
TimeoutStartSec=90

[Install]
WantedBy=multi-user.target
`
}

export function renderEnvFile(env: OpenclawEnv): string {
  return (
    Object.entries(env)
      .map(([k, v]) => `${k}=${dotenvEscape(v)}`)
      .join("\n") + "\n"
  )
}

function dotenvEscape(value: string): string {
  if (value === "") return ""
  if (/[\s"'$`\\]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  }
  return value
}
