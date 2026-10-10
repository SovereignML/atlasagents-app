import crypto from "node:crypto"
import { buildGatewayAllowedOrigins } from "@/lib/instance-gateway-access"
import { enabledToolsForRuntime } from "@/configs/agent-tools"
import type {
  BootstrapRenderArgs,
  BuildEnvArgs,
  RenderCaddyfileArgs,
  RenderConfigArgs,
  PackageRegistry,
  RuntimeEngine,
  RuntimeId,
  ToolServiceRoute,
} from "./types"
import { buildBootstrapFraming, browserInstallStep } from "./bootstrap"
import { npmSpec } from "@/lib/runtime-versions"

/* --- Caddy building blocks (shared by both runtime renderers) ------------ */

/**
 * A Caddy `reverse_proxy` block to a loopback port. The first line
 * (`reverse_proxy … {`) is emitted WITHOUT leading indent so the caller controls
 * where the block starts; the `header_up` lines sit at `indent + 2` and the
 * closing brace at `indent`. At indent "  " this is byte-identical to the
 * long-standing hand-written upstream blocks.
 */
export function caddyReverseProxy(port: number, indent: string): string {
  return `reverse_proxy localhost:${port} {
${indent}  header_up Host {host}
${indent}  header_up X-Real-IP {remote_host}
${indent}}`
}

/**
 * A Caddy `handle` block wrapping a `reverse_proxy`. `pathGlob` null → a
 * catch-all `handle { … }`. `indent` is the block's base column (the
 * `handle`/closing-brace column); the first line is emitted without leading
 * indent so the caller places it.
 */
function caddyHandleProxy(
  pathGlob: string | null,
  port: number,
  indent: string,
): string {
  const matcher = pathGlob ? `${pathGlob} ` : ""
  return `handle ${matcher}{
${indent}  ${caddyReverseProxy(port, indent + "  ")}
${indent}}`
}

/**
 * `handle <prefix>/*` blocks for per-tool companion services (e.g. n8n), with no
 * gateway catch-all — for splicing ahead of a body that already routes the
 * gateway (Hermes dual-route). Returns "" for an empty list. Each block's first
 * line is unindented; subsequent blocks carry `indent`.
 */
export function renderToolServiceHandles(
  toolServices: ToolServiceRoute[] | undefined,
  indent: string,
): string {
  if (!toolServices || toolServices.length === 0) return ""
  return toolServices
    .map((ts) => caddyHandleProxy(`${ts.pathPrefix}/*`, ts.port, indent))
    .join(`\n${indent}`)
}

/**
 * A full site-block body when companion services share the public host: one
 * `handle <prefix>/*` per service (ahead of the catch-all) plus a catch-all
 * `handle` to `gatewayPort`. First line unindented; subsequent blocks carry
 * `indent`.
 */
export function renderToolServiceSiteBody(
  toolServices: ToolServiceRoute[],
  gatewayPort: number,
  indent: string,
): string {
  return [
    ...toolServices.map((ts) =>
      caddyHandleProxy(`${ts.pathPrefix}/*`, ts.port, indent),
    ),
    caddyHandleProxy(null, gatewayPort, indent),
  ].join(`\n${indent}`)
}

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

export type RuntimeEnv = Record<string, string>

export function renderEnvFile(env: RuntimeEnv): string {
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

/**
 * Static description of a runtime engine. `createRuntime` turns this into a
 * full `RuntimeEngine` by deriving paths and the config/env/Caddy/systemd
 * renderers. Everything that differs between OpenClaw and Hermes lives here.
 */
export type RuntimeSpec = {
  id: RuntimeId
  displayName: string
  npmPackage: string
  /** Which package index `npmPackage` lives in. */
  registry: PackageRegistry
  version: () => string
  minNode: string
  gatewayPort: number
  serviceName: string
  cliBinary: string
  gatewayArgs: string
  /** Env-var prefix for runtime-specific keys, e.g. "OPENCLAW" -> OPENCLAW_MODEL. */
  envPrefix: string
  /**
   * Extra `Environment=` lines for the systemd unit, e.g.
   * ["NODE_COMPILE_CACHE=/var/tmp/openclaw-compile-cache", "OPENCLAW_NO_RESPAWN=1"].
   * Anything Node-compile-cache-related lives here, not in the shared renderer.
   */
  serviceEnv: string[]
  installDir: string
  configSubdir: string
  configFileName: string
  systemUser: string
  /** NODE_COMPILE_CACHE dir created during bootstrap; spec-only (not on the engine interface). */
  compileCacheDir: string
  /** HTTP path the gateway returns 200 on. Defaults to "/" if omitted. */
  healthPath?: string
}

export function createRuntime(spec: RuntimeSpec): RuntimeEngine {
  const configPath = `${spec.installDir}/${spec.configSubdir}/${spec.configFileName}`
  const workspaceDir = `${spec.installDir}/${spec.configSubdir}/workspace`
  const envPath = `${spec.installDir}/.env`

  function buildEnv(args: BuildEnvArgs): RuntimeEnv {
    const p = spec.envPrefix

    // OPENROUTER_API_KEY is the only LLM key the gateway gets: the package maps
    // its built-in `openrouter` provider to that env var (verified against the
    // published dist). Model selection lives in the rendered config file, not
    // env — the package reads no `${p}_MODEL`/`${p}_LLM_*` vars.
    const env: RuntimeEnv = {
      PORT: String(spec.gatewayPort),
      DOMAIN: args.instance.domain ?? "",
      OPENROUTER_API_KEY: args.openRouterApiKey,
      [`${p}_ADMIN_EMAIL`]: args.adminEmail,
      [`${p}_ADMIN_PASSWORD`]: args.adminPassword,
      INSTANCE_ID: args.instance.id,
    }

    return env
  }

  /**
   * Gateway JSON config. Bind mode `loopback` (Caddy on the same host proxies
   * all external traffic to it); trustedProxies names BOTH loopback addresses
   * so the gateway honours the forwarded headers from Caddy. The OpenRouter key
   * is passed via env (in .env), not in this config.
   *
   * Both, not just 127.0.0.1: the Caddyfile proxies to `localhost:<port>`, and
   * Caddy (Go) dials `localhost` as IPv6 `::1` first while the gateway listens
   * on both. Every openclaw release we install (2026.8.35 onwards) rejects a
   * request that carries forwarded headers from an untrusted peer
   * ("proxy_attribution_required"), so with only 127.0.0.1 listed every
   * proxied request — i.e. every browser visit to the agent URL — got a 403,
   * while the loopback-direct health check kept passing.
   *
   * Model refs are `<gateway-provider>/<model-id>`: the segment before the
   * FIRST slash selects the gateway's provider (and thus which API key env var
   * it authenticates with). A bare OpenRouter slug like `minimax/minimax-m2.5`
   * would select a `minimax` provider with no key and the agent fails on every
   * turn — so the OpenRouter slug must be prefixed with `openrouter/`.
   */
  function renderConfig(args: RenderConfigArgs): string {
    let allowedOrigins = buildGatewayAllowedOrigins({
      domain: args.domain,
      managedSubdomain: args.managedSubdomain,
      ipAddress: args.ipAddress,
      tlsStatus: args.domain ? args.tlsStatus : null,
    })
    if (allowedOrigins.length === 0) {
      allowedOrigins = [`http://localhost:${spec.gatewayPort}`]
    }

    const config: Record<string, unknown> = {
      gateway: {
        mode: "local",
        port: spec.gatewayPort,
        bind: "loopback",
        auth: { mode: "token" as const, token: args.gatewayToken },
        trustedProxies: ["127.0.0.1", "::1"],
        controlUi: {
          allowedOrigins,
          dangerouslyDisableDeviceAuth: true,
        },
      },
      agents: {
        defaults: {
          model: {
            primary: `openrouter/${args.model}`,
            fallbacks: [`openrouter/${args.fallbackModel}`],
          },
        },
        list: [{ id: "main" }],
      },
    }

    // Tool plugins: additive. With no tools enabled the output is byte-identical
    // to the gateway/agents-only config, so existing instances see no diff.
    const tools = enabledToolsForRuntime(args.enabledToolIds ?? [], spec.id)
    if (tools.some((t) => t.id === "browser")) {
      // Browser plugin — a dedicated, isolated Chromium profile the agent drives.
      // Chromium is auto-detected on PATH (installed at bootstrap / on enable).
      // `color` is REQUIRED by the gateway's browser-profile schema (omitting it
      // fails config validation → the gateway crash-loops → Caddy 502).
      // `executablePath` pins the real Google Chrome .deb (the box may also have
      // a snap chromium that can't launch under systemd). `noSandbox` is required
      // because the gateway runs headless as a non-login system user with no
      // user-namespace sandbox available.
      config.browser = {
        enabled: true,
        defaultProfile: "openclaw",
        executablePath: "/usr/bin/google-chrome",
        noSandbox: true,
        profiles: { openclaw: { cdpPort: 18800, color: "#FF4500" } },
      }
    }
    // Grant the enabled tools on top of the default profile allowlist. Skip
    // host-side tools (e.g. Knowledge Base) that have no runtime allowlist entry.
    const alsoAllow = tools
      .map((t) => t.support.openclaw?.toolName)
      .filter((n): n is string => !!n)
    if (alsoAllow.length > 0) {
      config.tools = { alsoAllow }
    }

    return JSON.stringify(config, null, 2) + "\n"
  }

  /**
   * Caddy reverse-proxies to the gateway on loopback. With a domain, Caddy
   * auto-provisions Let's Encrypt TLS. Without a domain, Caddy serves HTTP on
   * :80. Managed (Cloudflare-proxied) subdomains terminate TLS at the origin
   * via either a baked CF origin cert or `tls internal` (self-signed).
   */
  function renderCaddyfile(args: RenderCaddyfileArgs): string {
    // With no companion services this is byte-identical to the long-standing
    // bare `reverse_proxy`; with services (e.g. n8n) it becomes `handle` blocks
    // so `/n8n/*` can be routed ahead of the gateway catch-all.
    const upstreamBlock =
      args.toolServices && args.toolServices.length > 0
        ? renderToolServiceSiteBody(args.toolServices, spec.gatewayPort, "  ")
        : caddyReverseProxy(spec.gatewayPort, "  ")

    const port80 = `:80 {
  ${upstreamBlock}
}
`

    const domain = args.domain?.trim()
    if (domain) {
      // Behind the user's own Cloudflare proxy (orange-cloud): Cloudflare
      // terminates TLS at its edge and connects to the origin over HTTPS
      // without validating the cert (zone SSL = "Full", not strict), so a
      // self-signed `tls internal` cert is accepted. Keep :80 for Cloudflare's
      // origin pull / Always-Use-HTTPS health checks.
      if (args.domainUseInternalTls) {
        return `${domain} {
  tls internal
  ${upstreamBlock}
}

${port80}`
      }
      // Direct (grey-cloud / non-Cloudflare) custom domain: Caddy
      // auto-provisions Let's Encrypt TLS.
      return `${domain} {
  ${upstreamBlock}
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
  ${upstreamBlock}
}

${port80}`
    }

    if (managed) {
      return `${managed} {
  tls internal
  ${upstreamBlock}
}

${port80}`
    }

    return port80
  }

  /** systemd unit for the gateway daemon, run as the dedicated system user. */
  function renderSystemdUnit(): string {
    const envLines = [
      ...spec.serviceEnv.map((e) => `Environment=${e}`),
      `Environment=HOME=${spec.installDir}`,
    ].join("\n")

    return `[Unit]
Description=${spec.displayName} Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${spec.systemUser}
Group=${spec.systemUser}
WorkingDirectory=${spec.installDir}
EnvironmentFile=${envPath}
${envLines}
ExecStart=${spec.cliBinary} ${spec.gatewayArgs}
Restart=always
RestartSec=2
TimeoutStartSec=90

[Install]
WantedBy=multi-user.target
`
  }

  function renderBootstrap(args: BootstrapRenderArgs): string {
    // A resolved pin wins; otherwise fall back to the env override, else
    // `latest` — byte-identical to what this rendered before pinning existed.
    const pkgSpec = npmSpec(spec.npmPackage, args.runtimeVersion ?? spec.version())
    const installSteps = `
RUNTIME_PKG_SPEC=${shellEscapeForBash(pkgSpec)}

install_runtime_pkg() {
  local max=3 a=1 out
  out="$(mktemp)"
  while [ "$a" -le "$max" ]; do
    echo "=== npm install attempt $a/$max ==="
    if SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install -g --no-audit --no-fund --loglevel=warn --engine-strict "$RUNTIME_PKG_SPEC" 2>&1 | tee "$out"; then
      rm -f "$out"
      return 0
    fi
    # EBADENGINE is deterministic — the published package does not support the
    # Node on this box, and no amount of retrying changes that. Bail on the
    # first one. Retrying it three times cost ~25s per bake and, worse, filled
    # the bounded log tail with three identical errors, crowding out the
    # context above them that says which step and which versions.
    if grep -q "EBADENGINE" "$out"; then
      echo "npm refused $RUNTIME_PKG_SPEC for this Node version (EBADENGINE) — not retrying."
      echo "Raise the runtime's minNode (which also selects the Node the bootstrap installs) or pin the package version."
      rm -f "$out"
      return 1
    fi
    if [ "$a" -eq "$max" ]; then
      rm -f "$out"
      return 1
    fi
    if [ "$a" -eq $((max - 1)) ]; then
      npm cache clean --force 2>/dev/null || true
    fi
    sleep $((5 * a))
    a=$((a + 1))
  done
  rm -f "$out"
  return 1
}

step "install_runtime"
export SHARP_IGNORE_GLOBAL_LIBVIPS=1
install_runtime_pkg

step "verify_runtime_cli"
${spec.cliBinary} --version

step "compile_cache_dir"
mkdir -p ${shellEscapeForBash(spec.compileCacheDir)}
chown ${shellEscapeForBash(spec.systemUser)}:${shellEscapeForBash(spec.systemUser)} ${shellEscapeForBash(spec.compileCacheDir)}
${args.browserDeps === false ? "" : browserInstallStep()}`
    return buildBootstrapFraming(
      {
        installDir: spec.installDir,
        systemUser: spec.systemUser,
        minNodeVersion: spec.minNode,
        gatewayPort: args.gatewayPort,
        sshPort: args.sshPort,
        manageFirewall: args.manageFirewall,
      },
      installSteps,
    )
  }

  return {
    id: spec.id,
    displayName: spec.displayName,
    npmPackage: spec.npmPackage,
    registry: spec.registry,
    version: spec.version,
    minNode: spec.minNode,
    gatewayPort: spec.gatewayPort,
    serviceName: spec.serviceName,
    cliBinary: spec.cliBinary,
    gatewayArgs: spec.gatewayArgs,
    healthPath: spec.healthPath ?? "/",
    paths: {
      installDir: spec.installDir,
      configSubdir: spec.configSubdir,
      configFileName: spec.configFileName,
      configPath,
      workspaceDir,
      envPath,
      systemUser: spec.systemUser,
    },
    buildEnv,
    renderConfig,
    renderCaddyfile,
    renderSystemdUnit,
    renderBootstrap,
  }
}

function shellEscapeForBash(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
