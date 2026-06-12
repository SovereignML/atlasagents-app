import crypto from "node:crypto"
import { buildGatewayAllowedOrigins } from "@/lib/instance-gateway-access"
import type {
  BootstrapRenderArgs,
  BuildEnvArgs,
  RenderCaddyfileArgs,
  RenderConfigArgs,
  RuntimeEngine,
  RuntimeId,
} from "./types"
import { buildBootstrapFraming } from "./bootstrap"

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
   * all external traffic to 127.0.0.1); trustedProxies is 127.0.0.1 so the
   * gateway honours headers from Caddy. The OpenRouter key is passed via env
   * (in .env), not in this config.
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

    const config = {
      gateway: {
        mode: "local",
        port: spec.gatewayPort,
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
            primary: `openrouter/${args.model}`,
            fallbacks: [`openrouter/${args.fallbackModel}`],
          },
        },
        list: [{ id: "main" }],
      },
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
    const upstreamBlock = `reverse_proxy localhost:${spec.gatewayPort} {
    header_up Host {host}
    header_up X-Real-IP {remote_host}
  }`

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
    const pkgSpec = `${spec.npmPackage}@${spec.version()}`
    const installSteps = `
RUNTIME_PKG_SPEC=${shellEscapeForBash(pkgSpec)}

install_runtime_pkg() {
  local max=3 a=1
  while [ "$a" -le "$max" ]; do
    echo "=== npm install attempt $a/$max ==="
    if SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install -g --no-audit --no-fund --loglevel=warn --engine-strict "$RUNTIME_PKG_SPEC"; then
      return 0
    fi
    if [ "$a" -eq "$max" ]; then
      return 1
    fi
    if [ "$a" -eq $((max - 1)) ]; then
      npm cache clean --force 2>/dev/null || true
    fi
    sleep $((5 * a))
    a=$((a + 1))
  done
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
`
    return buildBootstrapFraming(
      {
        installDir: spec.installDir,
        systemUser: spec.systemUser,
        minNodeVersion: spec.minNode,
        gatewayPort: args.gatewayPort,
        cfOriginCertPem: args.cfOriginCertPem,
        cfOriginKeyPem: args.cfOriginKeyPem,
      },
      installSteps,
    )
  }

  return {
    id: spec.id,
    displayName: spec.displayName,
    npmPackage: spec.npmPackage,
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
