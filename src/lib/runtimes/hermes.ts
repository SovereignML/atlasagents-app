import { buildBootstrapFraming } from "./bootstrap"
import type {
  BootstrapRenderArgs,
  BuildEnvArgs,
  RenderCaddyfileArgs,
  RenderConfigArgs,
  RenderInitScriptArgs,
  RuntimeEngine,
  SidecarEnvArgs,
  SidecarSpec,
} from "./types"
import { buildGatewayAllowedOrigins } from "@/lib/instance-gateway-access"
import { resolveLlmProvider, nvidiaKeyForSlot } from "@/lib/model-router"

/**
 * Real Hermes runtime — Python package `hermes-agent` installed into a venv,
 * running `hermes gateway run` under systemd.
 *
 * Docs: https://hermes-agent.nousresearch.com/docs
 */

/** Resolve at call time so `HERMES_VERSION` env can override "latest". */
export const HERMES_VERSION = () => process.env.HERMES_VERSION || "latest"

/** Hermes spawns Node tooling at runtime (browser, WhatsApp); keep Node 22 floor. */
export const HERMES_VPS_MIN_NODE = "22.14.0"
/** Hermes requires Python 3.11+; Ubuntu 24.04 ships 3.12 so the floor is satisfied. */
export const HERMES_PYTHON_MIN = "3.11"

/** Hermes' default API server port. */
export const HERMES_GATEWAY_PORT = 8642
export const HERMES_SERVICE_NAME = "hermes-gateway"

const HERMES_INSTALL_DIR = "/opt/hermes"
const HERMES_VENV = "/opt/hermes/venv"
const HERMES_CLI = "/opt/hermes/venv/bin/hermes"
const HERMES_PIP = "/opt/hermes/venv/bin/pip"
const HERMES_CONFIG_SUBDIR = ".hermes"
const HERMES_CONFIG_FILE = "config.yaml"
const HERMES_SYSTEM_USER = "hermes"
const HERMES_PYPI_DIST = "hermes-agent"

const HERMES_CONFIG_PATH = `${HERMES_INSTALL_DIR}/${HERMES_CONFIG_SUBDIR}/${HERMES_CONFIG_FILE}`
const HERMES_WORKSPACE_DIR = `${HERMES_INSTALL_DIR}/${HERMES_CONFIG_SUBDIR}/workspace`
/** Hermes' `~/.hermes/.env` (one level deeper than OpenClaw's `/opt/openclaw/.env`). */
const HERMES_ENV_PATH = `${HERMES_INSTALL_DIR}/${HERMES_CONFIG_SUBDIR}/.env`

/* --- Open WebUI sidecar -------------------------------------------------- */
/**
 * Open WebUI runs as a native Python process in front of Hermes' OpenAI-
 * compatible API — installed via `pip install open-webui` into its own venv,
 * supervised by systemd. It binds loopback :8080 (Caddy proxies the public host
 * here); Hermes stays loopback-only on :8642 and is reached internally by Open
 * WebUI. No Docker daemon; the two runtimes share the same supervision model
 * (systemd) and the same packaging style (Python venv).
 */
export const OPEN_WEBUI_SERVICE_NAME = "open-webui"
export const OPEN_WEBUI_PORT = 8080
export const OPEN_WEBUI_VERSION = () => process.env.OPEN_WEBUI_VERSION || "latest"
const OPEN_WEBUI_INSTALL_DIR = "/opt/open-webui"
const OPEN_WEBUI_VENV = "/opt/open-webui/venv"
const OPEN_WEBUI_BIN = "/opt/open-webui/venv/bin/open-webui"
const OPEN_WEBUI_PIP = "/opt/open-webui/venv/bin/pip"
const OPEN_WEBUI_SYSTEM_USER = "open-webui"
const OPEN_WEBUI_DATA_DIR = "/opt/open-webui/data"
const OPEN_WEBUI_PYPI_DIST = "open-webui"
const OPEN_WEBUI_ENV_PATH = `${HERMES_INSTALL_DIR}/${HERMES_CONFIG_SUBDIR}/open-webui.env`

function openWebUiPipSpec(): string {
  const v = OPEN_WEBUI_VERSION()
  return v === "latest" ? OPEN_WEBUI_PYPI_DIST : `${OPEN_WEBUI_PYPI_DIST}==${v}`
}

function bashSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function pipPackageSpec(): string {
  const v = HERMES_VERSION()
  return v === "latest" ? HERMES_PYPI_DIST : `${HERMES_PYPI_DIST}==${v}`
}

/**
 * YAML-quote when the value contains anything outside a safe-ident set.
 * Our inputs (model names from a closed enum, fixed paths) keep this simple.
 */
function yamlString(s: string): string {
  if (s === "") return `""`
  if (/^[A-Za-z0-9_\-./]+$/.test(s)) return s
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

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
 * Site-block body for a single-upstream Hermes Caddyfile (legacy: webuiEnabled=false,
 * or any runtime without a sidecar). Matches today's `${corsBlock}  ${upstreamBlock}`
 * splice point — every line is indented 2 spaces relative to the surrounding site block.
 */
function buildSingleUpstreamBody(allowed: string[], upstreamPort: number): string {
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
  return `${cors}  reverse_proxy localhost:${upstreamPort} {
    header_up Host {host}
    header_up X-Real-IP {remote_host}
  }`
}

/**
 * Site-block body that path-routes inside a single host:
 *   `/v1/*` → Hermes gateway (loopback :8642, bearer-token auth)
 *   everything else → Open WebUI sidecar (its own session auth)
 *
 * Used for Hermes-with-WebUI (the default for new Hermes instances). Uses
 * Caddy's `handle` directive — NOT `handle_path` — so `/v1/chat/completions`
 * arrives at Hermes verbatim, not stripped to `/chat/completions`. `handle`
 * blocks are first-match, so order matters: the `/v1/*` block sits above the
 * catch-all.
 *
 * CORS rules live inside the `/v1/*` handler only — Open WebUI manages its
 * own headers and runs same-origin from the browser, so adding cross-origin
 * headers to its handler would break it.
 */
function buildDualRouteBody(allowed: string[], sidecarPort: number): string {
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
  return `  handle /v1/* {
${cors}    reverse_proxy localhost:${HERMES_GATEWAY_PORT} {
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

function buildHermesInstallSteps(): string {
  return `
RUNTIME_PKG_SPEC=${bashSingleQuote(pipPackageSpec())}

step "python_deps"
apt-get $APT_OPTS install -y python3 python3-venv python3-pip ripgrep ffmpeg

step "verify_python"
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)'; then
  PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
  echo "Hermes requires Python ${HERMES_PYTHON_MIN}+, found $PY_VER" >&2
  exit 1
fi

step "create_hermes_venv"
mkdir -p ${bashSingleQuote(HERMES_INSTALL_DIR)}
python3 -m venv ${bashSingleQuote(HERMES_VENV)}
${bashSingleQuote(HERMES_PIP)} install --upgrade pip setuptools wheel
chown -R ${bashSingleQuote(HERMES_SYSTEM_USER)}:${bashSingleQuote(HERMES_SYSTEM_USER)} ${bashSingleQuote(HERMES_INSTALL_DIR)}

step "install_hermes_pkg"
install_hermes_pkg() {
  local max=3 a=1
  while [ "$a" -le "$max" ]; do
    echo "=== pip install attempt $a/$max ==="
    if ${bashSingleQuote(HERMES_PIP)} install --upgrade "$RUNTIME_PKG_SPEC"; then
      return 0
    fi
    sleep $((5 * a))
    a=$((a + 1))
  done
  return 1
}
install_hermes_pkg

step "verify_hermes_cli"
${bashSingleQuote(HERMES_CLI)} --version

step "hermes_config_dir"
install -d -m 0750 -o ${bashSingleQuote(HERMES_SYSTEM_USER)} -g ${bashSingleQuote(HERMES_SYSTEM_USER)} ${bashSingleQuote(`${HERMES_INSTALL_DIR}/${HERMES_CONFIG_SUBDIR}`)}
install -d -m 0750 -o ${bashSingleQuote(HERMES_SYSTEM_USER)} -g ${bashSingleQuote(HERMES_SYSTEM_USER)} ${bashSingleQuote(HERMES_WORKSPACE_DIR)}
`
}

/**
 * Combined Hermes + Open WebUI install with the two heavy `pip install`s run **in parallel**.
 * Open WebUI's dependency tree (chromadb / sentence-transformers / …) dominates a cold
 * bootstrap; overlapping it with Hermes' install shaves real wall-clock. Each install keeps
 * its own 3× retry/backoff and its own PIP_CACHE_DIR (so the two never contend on the cache),
 * and the bootstrap fails if either errors. Used whenever the Open WebUI sidecar is enabled
 * (the default for new Hermes instances).
 */
function buildHermesPlusWebuiInstallSteps(): string {
  return `
RUNTIME_PKG_SPEC=${bashSingleQuote(pipPackageSpec())}
OPEN_WEBUI_PKG_SPEC=${bashSingleQuote(openWebUiPipSpec())}

step "python_deps"
apt-get $APT_OPTS install -y python3 python3-venv python3-pip ripgrep ffmpeg

step "verify_python"
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)'; then
  PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
  echo "Hermes requires Python ${HERMES_PYTHON_MIN}+, found $PY_VER" >&2
  exit 1
fi

step "create_hermes_venv"
mkdir -p ${bashSingleQuote(HERMES_INSTALL_DIR)}
python3 -m venv ${bashSingleQuote(HERMES_VENV)}
${bashSingleQuote(HERMES_PIP)} install --upgrade pip setuptools wheel
chown -R ${bashSingleQuote(HERMES_SYSTEM_USER)}:${bashSingleQuote(HERMES_SYSTEM_USER)} ${bashSingleQuote(HERMES_INSTALL_DIR)}

step "open_webui_user"
id ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} >/dev/null 2>&1 || useradd --system --home-dir ${bashSingleQuote(OPEN_WEBUI_INSTALL_DIR)} --shell /usr/sbin/nologin ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)}

step "open_webui_dirs"
install -d -m 0750 -o ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} -g ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} ${bashSingleQuote(OPEN_WEBUI_INSTALL_DIR)}
install -d -m 0750 -o ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} -g ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} ${bashSingleQuote(OPEN_WEBUI_DATA_DIR)}

step "open_webui_venv"
python3 -m venv ${bashSingleQuote(OPEN_WEBUI_VENV)}
${bashSingleQuote(OPEN_WEBUI_PIP)} install --upgrade pip setuptools wheel
chown -R ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)}:${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} ${bashSingleQuote(OPEN_WEBUI_INSTALL_DIR)}

install_hermes_pkg() {
  local max=3 a=1
  while [ "$a" -le "$max" ]; do
    echo "=== pip install hermes attempt $a/$max ==="
    if PIP_CACHE_DIR=/var/tmp/pip-cache-hermes ${bashSingleQuote(HERMES_PIP)} install --upgrade "$RUNTIME_PKG_SPEC"; then
      return 0
    fi
    sleep $((5 * a))
    a=$((a + 1))
  done
  return 1
}
install_open_webui_pkg() {
  local max=3 a=1
  while [ "$a" -le "$max" ]; do
    echo "=== pip install open-webui attempt $a/$max ==="
    if PIP_CACHE_DIR=/var/tmp/pip-cache-owui ${bashSingleQuote(OPEN_WEBUI_PIP)} install --upgrade "$OPEN_WEBUI_PKG_SPEC"; then
      return 0
    fi
    sleep $((5 * a))
    a=$((a + 1))
  done
  return 1
}

step "install_pkgs_parallel"
install_hermes_pkg > /var/log/pip-hermes.log 2>&1 &
HPID=$!
install_open_webui_pkg > /var/log/pip-owui.log 2>&1 &
OPID=$!
HRC=0; ORC=0
wait "$HPID" || HRC=$?
wait "$OPID" || ORC=$?
echo "--- hermes pip log ---"; tail -n 30 /var/log/pip-hermes.log 2>/dev/null || true
echo "--- open-webui pip log ---"; tail -n 30 /var/log/pip-owui.log 2>/dev/null || true
if [ "$HRC" -ne 0 ]; then echo "hermes pip install failed (rc=$HRC)" >&2; exit 1; fi
if [ "$ORC" -ne 0 ]; then echo "open-webui pip install failed (rc=$ORC)" >&2; exit 1; fi

step "verify_hermes_cli"
${bashSingleQuote(HERMES_CLI)} --version

step "verify_open_webui_cli"
${bashSingleQuote(OPEN_WEBUI_BIN)} --help >/dev/null

step "hermes_config_dir"
install -d -m 0750 -o ${bashSingleQuote(HERMES_SYSTEM_USER)} -g ${bashSingleQuote(HERMES_SYSTEM_USER)} ${bashSingleQuote(`${HERMES_INSTALL_DIR}/${HERMES_CONFIG_SUBDIR}`)}
install -d -m 0750 -o ${bashSingleQuote(HERMES_SYSTEM_USER)} -g ${bashSingleQuote(HERMES_SYSTEM_USER)} ${bashSingleQuote(HERMES_WORKSPACE_DIR)}
`
}

/**
 * Open WebUI sidecar — a native Python process (installed via pip into its own
 * venv) fronting Hermes' OpenAI-compatible API. systemd supervises it directly;
 * there is no Docker daemon, no container, no named volume. The venv is
 * isolated from Hermes' venv so Open WebUI's chunky dep tree (chromadb,
 * sentence-transformers, etc.) can't break Hermes' pins. Reaches Hermes on
 * 127.0.0.1:8642 and binds its own UI on 127.0.0.1:8080 (HOST/PORT from the env
 * file); Caddy is the only public ingress.
 */
const openWebUiSidecar: SidecarSpec = {
  serviceName: OPEN_WEBUI_SERVICE_NAME,
  port: OPEN_WEBUI_PORT,
  healthPath: "/health",
  dataDir: OPEN_WEBUI_DATA_DIR,
  envPath: OPEN_WEBUI_ENV_PATH,
  seedAdmin: { signupPath: "/api/v1/auths/signup" },

  /**
   * Pip-installs `open-webui` into a venv under /opt/open-webui. Runs AFTER
   * Hermes' install steps, so python3 / python3-venv / python3-pip are already
   * present. Idempotent: re-running upgrades the package in place.
   */
  installSteps(): string {
    return `
OPEN_WEBUI_PKG_SPEC=${bashSingleQuote(openWebUiPipSpec())}

step "open_webui_user"
id ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} >/dev/null 2>&1 || useradd --system --home-dir ${bashSingleQuote(OPEN_WEBUI_INSTALL_DIR)} --shell /usr/sbin/nologin ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)}

step "open_webui_dirs"
install -d -m 0750 -o ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} -g ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} ${bashSingleQuote(OPEN_WEBUI_INSTALL_DIR)}
install -d -m 0750 -o ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} -g ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} ${bashSingleQuote(OPEN_WEBUI_DATA_DIR)}

step "open_webui_venv"
python3 -m venv ${bashSingleQuote(OPEN_WEBUI_VENV)}
${bashSingleQuote(OPEN_WEBUI_PIP)} install --upgrade pip setuptools wheel
chown -R ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)}:${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} ${bashSingleQuote(OPEN_WEBUI_INSTALL_DIR)}

step "install_open_webui_pkg"
install_open_webui_pkg() {
  local max=3 a=1
  while [ "$a" -le "$max" ]; do
    echo "=== pip install open-webui attempt $a/$max ==="
    if ${bashSingleQuote(OPEN_WEBUI_PIP)} install --upgrade "$OPEN_WEBUI_PKG_SPEC"; then
      return 0
    fi
    sleep $((5 * a))
    a=$((a + 1))
  done
  return 1
}
install_open_webui_pkg

step "verify_open_webui_cli"
${bashSingleQuote(OPEN_WEBUI_BIN)} --help >/dev/null
`
  },

  /**
   * Open WebUI env. Auth is required (the public URL must not be open); RAG/STT
   * use the OpenAI engine to avoid loading local models (~500MB RAM) on small
   * boxes. Points at Hermes' loopback API with the gateway token as the key.
   * DATA_DIR holds the SQLite DB + uploads; persisting it is what makes
   * accounts/chats survive restarts.
   */
  renderEnv(args: SidecarEnvArgs): Record<string, string> {
    const env: Record<string, string> = {
      WEBUI_AUTH: "true",
      WEBUI_SECRET_KEY: args.secretKey,
      ENABLE_SIGNUP: args.enableSignup ? "true" : "false",
      ENABLE_LOGIN_FORM: "true",
      OPENAI_API_BASE_URL: `http://127.0.0.1:${args.gatewayPort}/v1`,
      OPENAI_API_KEY: args.gatewayToken,
      ENABLE_OLLAMA_API: "false",
      RAG_EMBEDDING_ENGINE: "openai",
      AUDIO_STT_ENGINE: "openai",
      DATA_DIR: OPEN_WEBUI_DATA_DIR,
      HOST: "127.0.0.1",
      PORT: String(OPEN_WEBUI_PORT),
    }
    if (args.publicUrl) env.WEBUI_URL = args.publicUrl
    return env
  },

  renderSystemdUnit(): string {
    return `[Unit]
Description=Open WebUI (Hermes chat UI)
After=network-online.target ${HERMES_SERVICE_NAME}.service
Requires=${HERMES_SERVICE_NAME}.service
Wants=network-online.target

[Service]
Type=simple
User=${OPEN_WEBUI_SYSTEM_USER}
Group=${OPEN_WEBUI_SYSTEM_USER}
WorkingDirectory=${OPEN_WEBUI_INSTALL_DIR}
EnvironmentFile=${OPEN_WEBUI_ENV_PATH}
Environment=HOME=${OPEN_WEBUI_INSTALL_DIR}
ExecStart=${OPEN_WEBUI_BIN} serve
Restart=always
RestartSec=3
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
`
  },
}

export const hermesRuntime: RuntimeEngine = {
  id: "hermes",
  displayName: "Hermes",
  npmPackage: HERMES_PYPI_DIST,
  version: HERMES_VERSION,
  minNode: HERMES_VPS_MIN_NODE,
  gatewayPort: HERMES_GATEWAY_PORT,
  serviceName: HERMES_SERVICE_NAME,
  cliBinary: HERMES_CLI,
  gatewayArgs: "gateway run",
  healthPath: "/health",
  // Hermes owns its config.yaml via the CLI (renderInitScript); the provisioner writes only
  // the .env and skips the hand-rendered config file.
  managesOwnConfig: true,
  paths: {
    installDir: HERMES_INSTALL_DIR,
    configSubdir: HERMES_CONFIG_SUBDIR,
    configFileName: HERMES_CONFIG_FILE,
    configPath: HERMES_CONFIG_PATH,
    workspaceDir: HERMES_WORKSPACE_DIR,
    envPath: HERMES_ENV_PATH,
    systemUser: HERMES_SYSTEM_USER,
  },

  /**
   * Hermes' .env — no prefix convention. Auth via `API_SERVER_KEY`
   * (= our gatewayToken). Listens on loopback; Caddy is the only external
   * reverse proxy. `adminEmail` / `adminPassword` are ignored.
   */
  buildEnv(args: BuildEnvArgs): Record<string, string> {
    const provider = resolveLlmProvider(args.instance)

    // On the NVIDIA-primary switch, feed the gateway the NVIDIA key via the same
    // key var; the provider/base-url are pinned by renderInitScript. Best-effort
    // for Hermes — verify on a real VPS (see renderInitScript note).
    const primaryKey =
      provider === "nvidia" ? nvidiaKeyForSlot("primary") : args.openRouterApiKey

    const env: Record<string, string> = {
      API_SERVER_ENABLED: "true",
      API_SERVER_KEY: args.gatewayToken,
      API_SERVER_HOST: "127.0.0.1",
      API_SERVER_PORT: String(HERMES_GATEWAY_PORT),
      OPENROUTER_API_KEY: primaryKey,
      INSTANCE_ID: args.instance.id,
      DOMAIN: args.instance.domain ?? "",
    }

    // The API server applies its own CORS allowlist (so browser clients on the instance's
    // own origins can call /v1 directly). Mirror the Caddy allowlist; API_SERVER_* keys are
    // .env-only per the Hermes API-server docs.
    const corsOrigins = buildGatewayAllowedOrigins({
      domain: args.instance.domain,
      managedSubdomain: args.instance.managedSubdomain,
      ipAddress: null,
      tlsStatus: null,
    })
    if (corsOrigins.length > 0) {
      env.API_SERVER_CORS_ORIGINS = corsOrigins.join(",")
    }

    // Always expose the NVIDIA key for the best-effort cross-provider fallback.
    const nvidiaKey = nvidiaKeyForSlot("primary")
    if (nvidiaKey) env.NVIDIA_API_KEY = nvidiaKey

    return env
  },

  /**
   * Minimal YAML. Auth, port, host, provider API keys all come from .env via
   * EnvironmentFile, which the docs show as the supported override path.
   * Keeps schema risk low while the YAML field names are not 100% documented.
   */
  renderConfig(args: RenderConfigArgs): string {
    // With `managesOwnConfig: true` the provisioner does NOT write this file — `hermes config
    // set` (see renderInitScript) owns ~/.hermes/config.yaml so the on-disk schema always
    // matches the installed package. Kept only as a documented, correct fallback: the real
    // Hermes schema is `model.provider` + `model.default` (no `version`/`workspace` keys).
    return `# Generated by SovereignML (fallback only — Hermes manages its own config via CLI).
model:
  provider: openrouter
  default: ${yamlString(args.model)}
`
  },

  /**
   * Caddy reverse-proxy + CORS at the proxy layer (Hermes' YAML has no
   * allowed-origins field). Matches the OpenClaw renderer's domain-vs-managed
   * topology so DNS/TLS handling stays identical.
   *
   * Two body shapes:
   *  - **Dual-route** (`upstreamPort` set, i.e. webuiEnabled=true): path-routes
   *    `/v1/*` to Hermes :8642 and everything else to Open WebUI on
   *    `upstreamPort`. One public host serves both the chat UI and the
   *    OpenAI-compatible API for external bots.
   *  - **Single-upstream** (`upstreamPort` undefined, i.e. legacy
   *    webuiEnabled=false rows): proxies the whole host to Hermes :8642.
   *    Kept for back-compat — existing instances don't get surprise re-routed.
   */
  renderCaddyfile(args: RenderCaddyfileArgs): string {
    const allowed = buildGatewayAllowedOrigins({
      domain: args.domain,
      managedSubdomain: args.managedSubdomain,
      ipAddress: null,
      tlsStatus: null,
    })

    const body = args.upstreamPort
      ? buildDualRouteBody(allowed, args.upstreamPort)
      : buildSingleUpstreamBody(allowed, HERMES_GATEWAY_PORT)

    const domain = args.domain?.trim()
    if (domain) {
      return `${domain} {
${body}
}
`
    }

    const port80 = `:80 {
${body}
}
`
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
  },

  renderSystemdUnit(): string {
    return `[Unit]
Description=Hermes Gateway
After=network-online.target
Wants=network-online.target
# Trip into "failed" after repeated rapid crashes (e.g. a bad config) instead of looping
# forever — the provisioner's NRestarts/crash-loop check then surfaces it as a clear failure.
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=${HERMES_SYSTEM_USER}
Group=${HERMES_SYSTEM_USER}
WorkingDirectory=${HERMES_INSTALL_DIR}
EnvironmentFile=${HERMES_ENV_PATH}
Environment=HOME=${HERMES_INSTALL_DIR}
ExecStart=${HERMES_CLI} gateway run
Restart=always
RestartSec=3
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
`
  },

  renderBootstrap(args: BootstrapRenderArgs): string {
    // Sidecar enabled → install Hermes and Open WebUI with their pip steps overlapped
    // (buildHermesPlusWebuiInstallSteps). Legacy API-only Hermes → Hermes alone.
    const installSteps = args.webuiEnabled
      ? buildHermesPlusWebuiInstallSteps()
      : buildHermesInstallSteps()
    return buildBootstrapFraming(
      {
        installDir: HERMES_INSTALL_DIR,
        systemUser: HERMES_SYSTEM_USER,
        minNodeVersion: HERMES_VPS_MIN_NODE,
        gatewayPort: args.gatewayPort,
        cfOriginCertPem: args.cfOriginCertPem,
        cfOriginKeyPem: args.cfOriginKeyPem,
      },
      installSteps,
    )
  },

  /**
   * Real Hermes initialization, run over SSH after the `.env` is written and before the
   * gateway starts. Drives the official CLI as the hermes user so ~/.hermes/config.yaml is
   * produced by the installed package itself (migration-safe), then hard-validates with
   * `config check` + `doctor`. A non-zero exit fails the provision (→ rollback). Idempotent:
   * `setup --quick` skips configured items and `config set` overwrites keys, so retries and
   * reprovision re-run cleanly. Secrets are NOT passed on the command line (they live in the
   * already-written .env, which the CLI reads) — avoids leaking into the process table/logs.
   */
  renderInitScript(args: RenderInitScriptArgs): string {
    const run = (sub: string) =>
      `sudo -u ${bashSingleQuote(args.systemUser)} env HOME=${bashSingleQuote(args.installDir)} ${bashSingleQuote(args.cliBinary)} ${sub}`
    // For a non-OpenRouter (NVIDIA) provider, also point Hermes at the custom
    // OpenAI-compatible base URL. The exact config key for a custom provider is
    // undocumented, so this is best-effort (non-fatal); the provider/model sets
    // below stay fatal so a truly unusable config fails the provision loudly.
    // Verify Hermes+NVIDIA on a real VPS before relying on it.
    const baseUrlStep =
      args.provider !== "openrouter"
        ? `${run(`config set model.base_url ${bashSingleQuote(args.baseUrl)}`)} || echo "warn: could not set model.base_url (provider=${args.provider})" >&2\n`
        : ""
    return `#!/bin/bash
set -uo pipefail

echo "=== provision: hermes_setup ==="
if ! ${run("setup --non-interactive --quick")}; then
  echo "hermes setup failed" >&2
  exit 1
fi

echo "=== provision: hermes_config ==="
${run(`config set model.provider ${bashSingleQuote(args.provider)}`)} || exit 1
${run(`config set model.default ${bashSingleQuote(args.model)}`)} || exit 1
${baseUrlStep}${run("config set terminal.backend local")} || exit 1

echo "=== provision: hermes_config_check ==="
if ! ${run("config check")}; then
  echo "hermes config check failed" >&2
  ${run("config show")} 2>/dev/null || true
  exit 1
fi

echo "=== provision: hermes_doctor ==="
if ! ${run("doctor --fix")}; then
  echo "hermes doctor failed" >&2
  ${run("config show")} 2>/dev/null || true
  exit 1
fi

echo "=== provision: hermes_init_done ==="
`
  },

  sidecar: openWebUiSidecar,
}
