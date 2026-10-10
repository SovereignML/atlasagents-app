import { buildBootstrapFraming, browserInstallStep } from "./bootstrap"
import type {
  BootstrapRenderArgs,
  BuildEnvArgs,
  RenderCaddyfileArgs,
  RenderConfigArgs,
  RenderInitScriptArgs,
  RuntimeEngine,
  SidecarEnvArgs,
  SidecarSpec,
  ToolServiceRoute,
} from "./types"
import { buildGatewayAllowedOrigins } from "@/lib/instance-gateway-access"
import { pypiSpec } from "@/lib/runtime-versions"
import { resolveLlmProvider, nvidiaKeyForSlot } from "@/lib/model-router"
import { enabledToolsForRuntime } from "@/configs/agent-tools"
import {
  renderToolServiceHandles,
  renderToolServiceSiteBody,
} from "./shared"
import { RUNTIME_CAPS } from "./labels"

/**
 * Real Hermes runtime — Python package `hermes-agent` installed into a venv,
 * running `hermes gateway run` under systemd.
 *
 * Docs: https://hermes-agent.nousresearch.com/docs
 */

/**
 * The hermes-agent release new boxes install.
 *
 * Not one behind latest, unlike the other pins: 0.19.0 IS the latest release
 * and has been since 2026-07-20, so every Hermes agent provisioned in the last
 * three months runs it. Pinning 0.18.2 would make new agents older than the
 * existing fleet for no stability gain, and our init script (`setup --quick`,
 * `config check`, `doctor --fix`) has only ever run against 0.19.0. When 0.20
 * ships, this stays put until it has soaked — see docs/RUNTIMES.md.
 *
 * `HERMES_VERSION` overrides it (a version, or `latest`).
 */
export const HERMES_PINNED_VERSION = "0.19.0"

/** Resolve at call time so `HERMES_VERSION` env can override the pin. */
export const HERMES_VERSION = () => process.env.HERMES_VERSION || HERMES_PINNED_VERSION

/**
 * Minimum Node on a Hermes VPS. Hermes itself is Python — this floor exists
 * for the Node tooling it spawns, and it also selects the NodeSource
 * distribution the bootstrap installs (see nodeSourceMajor in bootstrap.ts).
 *
 * This was 22.14.0, which was wrong on two counts:
 *
 *  1. `agent-browser` — installed globally on every Hermes box for the browser
 *     tool (see buildBrowserDepsSteps) — declares `engines.node: >=24.0.0`, and
 *     has in EVERY published version. That install runs without
 *     `--engine-strict`, so npm only warned and put a package on the box that
 *     its own manifest says cannot run there. The same failure class as the
 *     openclaw EBADENGINE incident, minus the loud failure.
 *  2. Prebake installs one Node major before the runtime is chosen. With the
 *     two runtimes naming different majors, whichever bootstrap ran second
 *     would drag the box to its own major — OpenClaw's 24 down to 22 here.
 *
 * 24.16.0 matches OPENCLAW_VPS_MIN_NODE exactly, so one Node major serves both
 * runtimes and a box never gets pulled between them. Do not lower it without
 * re-checking `agent-browser`'s engines.
 */
export const HERMES_VPS_MIN_NODE = "24.16.0"
/** Hermes requires Python 3.11+; Ubuntu 24.04 ships 3.12 so the floor is satisfied. */
export const HERMES_PYTHON_MIN = "3.11"
/**
 * Exclusive Python ceilings, from the packages' own `requires_python`:
 * `hermes-agent` is `>=3.11,<3.14`, `open-webui` is `>=3.11,<3.13.0a1`.
 *
 * The bootstrap only ever checked the FLOOR. That is harmless on a managed VPS
 * (Ubuntu 24.04, Python 3.12) but not on BYOS, where the preflight admits any
 * amd64 Ubuntu or Debian with no release restriction — and Debian 13 and
 * Ubuntu 25.x ship Python 3.13. Those boxes sailed past verify_python and then
 * died several minutes later at `install_pkgs_parallel`, after the apt work,
 * the venvs and most of a 900s timeout had already been spent.
 */
export const HERMES_PYTHON_MAX_EXCLUSIVE = "3.14"
export const OPEN_WEBUI_PYTHON_MAX_EXCLUSIVE = "3.13"

/**
 * `verify_python` for a given exclusive upper bound. Fails in seconds, with a
 * message naming the actual version, rather than letting a doomed install run.
 */
function buildVerifyPythonStep(maxExclusive: string): string {
  const [maj, min] = maxExclusive.split(".")
  return `step "verify_python"
if ! python3 -c 'import sys; sys.exit(0 if (3, 11) <= sys.version_info[:2] < (${maj}, ${min}) else 1)'; then
  PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
  echo "Requires Python ${HERMES_PYTHON_MIN}+ and older than ${maxExclusive}, found $PY_VER" >&2
  exit 1
fi`
}

/** Hermes' default API server port. */
export const HERMES_GATEWAY_PORT = 8642
export const HERMES_SERVICE_NAME = "hermes-gateway"

const HERMES_INSTALL_DIR = "/opt/hermes"
const HERMES_VENV = "/opt/hermes/venv"
const HERMES_CLI = "/opt/hermes/venv/bin/hermes"
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
/**
 * The Open WebUI release new Hermes boxes install: one behind PyPI's latest
 * (0.11.4 at the time of pinning), which was a large feature release. Bump on
 * purpose after a test deploy. `OPEN_WEBUI_VERSION` overrides it.
 */
export const OPEN_WEBUI_PINNED_VERSION = "0.11.3"
export const OPEN_WEBUI_VERSION = () => process.env.OPEN_WEBUI_VERSION || OPEN_WEBUI_PINNED_VERSION
const OPEN_WEBUI_INSTALL_DIR = "/opt/open-webui"
const OPEN_WEBUI_VENV = "/opt/open-webui/venv"
const OPEN_WEBUI_BIN = "/opt/open-webui/venv/bin/open-webui"
const OPEN_WEBUI_SYSTEM_USER = "open-webui"
const OPEN_WEBUI_DATA_DIR = "/opt/open-webui/data"
const OPEN_WEBUI_PYPI_DIST = "open-webui"
const OPEN_WEBUI_ENV_PATH = `${HERMES_INSTALL_DIR}/${HERMES_CONFIG_SUBDIR}/open-webui.env`

/**
 * PyTorch's CPU-only wheel index. Open WebUI's torch comes from here instead of
 * PyPI's CUDA build — see `py_install_cpu_torch` in buildPyInstallPrelude.
 */
export const TORCH_CPU_INDEX_URL = "https://download.pytorch.org/whl/cpu"

function openWebUiPipSpec(pin?: string): string {
  return pypiSpec(OPEN_WEBUI_PYPI_DIST, pin ?? OPEN_WEBUI_VERSION())
}

function bashSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function pipPackageSpec(pin?: string): string {
  return pypiSpec(HERMES_PYPI_DIST, pin ?? HERMES_VERSION())
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
function buildSingleUpstreamBody(
  allowed: string[],
  upstreamPort: number,
  toolServices?: ToolServiceRoute[],
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
function buildDualRouteBody(
  allowed: string[],
  sidecarPort: number,
  toolServices?: ToolServiceRoute[],
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
  // Companion-service handles (e.g. `/n8n/*`) go FIRST — `handle` is first-match,
  // so they must sit above `/v1/*` and the catch-all. Empty → no prefix.
  const toolHandles = renderToolServiceHandles(toolServices, "  ")
  const toolPrefix = toolHandles ? `  ${toolHandles}\n` : ""
  return `${toolPrefix}  handle /v1/* {
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

/**
 * Browser tool system deps for Hermes: a headless Chromium plus the
 * `agent-browser` npm global the local browser provider drives. Spliced into
 * Hermes' install steps (inside the framing, so `step`/`APT_OPTS`/Node exist).
 * Pre-baked on every Hermes box so enabling the browser tool later is a
 * config-only restart. Idempotent.
 */
function buildBrowserDepsSteps(): string {
  return `${browserInstallStep()}
step "install_agent_browser"
npm ls -g agent-browser >/dev/null 2>&1 || npm install -g --no-audit --no-fund agent-browser
`
}

/**
 * Shared shell prelude for the Python installs: `uv` when it can be had, pip
 * otherwise.
 *
 * The Python path dominates a cold Hermes bootstrap — two venvs and 236
 * packages, of which Open WebUI's 146MB wheel and its ~116 dependencies are
 * most of the weight. `uv` resolves and installs that tree several times
 * faster than pip, and it is a single static binary.
 *
 * It is strictly an accelerator. Every function here falls back to pip when
 * `uv` is missing or its install fails, because astral.sh would otherwise
 * become a new hard dependency on the critical path of every Hermes
 * provision — trading a slow bootstrap for a broken one.
 *
 * `python3 -m venv --upgrade-deps` in the fallback also removes the separate
 * `pip install --upgrade pip setuptools wheel` round-trip that used to run
 * once per venv.
 */
function buildPyInstallPrelude(): string {
  return `
step "install_uv"
# Best-effort. UV_INSTALL_DIR puts it somewhere on root's PATH; a failure here
# is not fatal, it just means the pip fallback below does the work.
export UV_INSTALL_DIR=/usr/local/bin
curl -fsSL --retry 3 --retry-delay 2 https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || true
command -v uv >/dev/null 2>&1 && uv --version || echo "uv unavailable — falling back to pip"

# venv_create <venv-path>
venv_create() {
  local venv="$1"
  if command -v uv >/dev/null 2>&1 && uv venv "$venv" >/dev/null 2>&1; then
    return 0
  fi
  python3 -m venv --upgrade-deps "$venv"
}

# py_install <venv-path> <pkg-spec> <cache-dir>
# Retries transient failures 3x with backoff, same contract the pip-only
# version had. Each caller gets its own cache dir so two parallel installs
# never contend on one.
py_install() {
  local venv="$1" spec="$2" cache="$3" max=3 a=1
  while [ "$a" -le "$max" ]; do
    echo "=== install attempt $a/$max: $spec ==="
    if command -v uv >/dev/null 2>&1; then
      if UV_CACHE_DIR="$cache" uv pip install --python "$venv/bin/python" --upgrade "$spec"; then
        return 0
      fi
    else
      if PIP_CACHE_DIR="$cache" "$venv/bin/pip" install --upgrade "$spec"; then
        return 0
      fi
    fi
    sleep $((5 * a))
    a=$((a + 1))
  done
  return 1
}

# py_install_cpu_torch <venv-path> <pkg-spec> <cache-dir>
# Open WebUI pulls in torch (via sentence-transformers), and on Linux PyPI's
# torch is the CUDA build: ~3.2GB of GPU libraries (cuDNN, cuBLAS, NCCL,
# triton...) on a box with no GPU, for an Open WebUI that we point at the
# OpenAI engine for embeddings and speech-to-text anyway. Ask for the CPU build
# first, the way Open WebUI's own image does; if the PyTorch index cannot be
# reached, fall back to the default index — the old, much larger install —
# rather than fail the deploy over a download optimisation.
py_install_cpu_torch() {
  if UV_TORCH_BACKEND=cpu PIP_EXTRA_INDEX_URL=${bashSingleQuote(TORCH_CPU_INDEX_URL)} py_install "$@"; then
    return 0
  fi
  echo "=== CPU-only torch install failed — retrying with the default (CUDA) torch ==="
  py_install "$@"
}
`
}

function buildHermesInstallSteps(browserDeps: boolean, pin?: string): string {
  return `
RUNTIME_PKG_SPEC=${bashSingleQuote(pipPackageSpec(pin))}

step "python_deps"
apt-get $APT_OPTS install -y python3 python3-venv python3-pip ripgrep ffmpeg

${buildVerifyPythonStep(HERMES_PYTHON_MAX_EXCLUSIVE)}

${buildPyInstallPrelude()}
step "create_hermes_venv"
mkdir -p ${bashSingleQuote(HERMES_INSTALL_DIR)}
venv_create ${bashSingleQuote(HERMES_VENV)}
chown -R ${bashSingleQuote(HERMES_SYSTEM_USER)}:${bashSingleQuote(HERMES_SYSTEM_USER)} ${bashSingleQuote(HERMES_INSTALL_DIR)}

step "install_hermes_pkg"
py_install ${bashSingleQuote(HERMES_VENV)} "$RUNTIME_PKG_SPEC" /var/tmp/py-cache-hermes

step "verify_hermes_cli"
${bashSingleQuote(HERMES_CLI)} --version

step "hermes_config_dir"
install -d -m 0750 -o ${bashSingleQuote(HERMES_SYSTEM_USER)} -g ${bashSingleQuote(HERMES_SYSTEM_USER)} ${bashSingleQuote(`${HERMES_INSTALL_DIR}/${HERMES_CONFIG_SUBDIR}`)}
install -d -m 0750 -o ${bashSingleQuote(HERMES_SYSTEM_USER)} -g ${bashSingleQuote(HERMES_SYSTEM_USER)} ${bashSingleQuote(HERMES_WORKSPACE_DIR)}
${browserDeps ? buildBrowserDepsSteps() : ""}`
}

/**
 * Combined Hermes + Open WebUI install with the two heavy `pip install`s run **in parallel**.
 * Open WebUI's dependency tree (chromadb / sentence-transformers / …) dominates a cold
 * bootstrap; overlapping it with Hermes' install shaves real wall-clock. Each install keeps
 * its own 3× retry/backoff and its own PIP_CACHE_DIR (so the two never contend on the cache),
 * and the bootstrap fails if either errors. Used whenever the Open WebUI sidecar is enabled
 * (the default for new Hermes instances).
 */
function buildHermesPlusWebuiInstallSteps(
  browserDeps: boolean,
  pin?: string,
  webuiPin?: string,
): string {
  return `
RUNTIME_PKG_SPEC=${bashSingleQuote(pipPackageSpec(pin))}
OPEN_WEBUI_PKG_SPEC=${bashSingleQuote(openWebUiPipSpec(webuiPin))}

step "python_deps"
apt-get $APT_OPTS install -y python3 python3-venv python3-pip ripgrep ffmpeg

${buildVerifyPythonStep(OPEN_WEBUI_PYTHON_MAX_EXCLUSIVE)}

${buildPyInstallPrelude()}
step "create_hermes_venv"
mkdir -p ${bashSingleQuote(HERMES_INSTALL_DIR)}
venv_create ${bashSingleQuote(HERMES_VENV)}
chown -R ${bashSingleQuote(HERMES_SYSTEM_USER)}:${bashSingleQuote(HERMES_SYSTEM_USER)} ${bashSingleQuote(HERMES_INSTALL_DIR)}

step "open_webui_user"
id ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} >/dev/null 2>&1 || useradd --system --home-dir ${bashSingleQuote(OPEN_WEBUI_INSTALL_DIR)} --shell /usr/sbin/nologin ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)}

step "open_webui_dirs"
install -d -m 0750 -o ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} -g ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} ${bashSingleQuote(OPEN_WEBUI_INSTALL_DIR)}
install -d -m 0750 -o ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} -g ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} ${bashSingleQuote(OPEN_WEBUI_DATA_DIR)}

step "open_webui_venv"
venv_create ${bashSingleQuote(OPEN_WEBUI_VENV)}
chown -R ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)}:${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} ${bashSingleQuote(OPEN_WEBUI_INSTALL_DIR)}

step "install_pkgs_parallel"
py_install ${bashSingleQuote(HERMES_VENV)} "$RUNTIME_PKG_SPEC" /var/tmp/py-cache-hermes > /var/log/py-hermes.log 2>&1 &
HPID=$!
py_install_cpu_torch ${bashSingleQuote(OPEN_WEBUI_VENV)} "$OPEN_WEBUI_PKG_SPEC" /var/tmp/py-cache-owui > /var/log/py-owui.log 2>&1 &
OPID=$!
HRC=0; ORC=0
wait "$HPID" || HRC=$?
wait "$OPID" || ORC=$?
echo "--- hermes install log ---"; tail -n 30 /var/log/py-hermes.log 2>/dev/null || true
echo "--- open-webui install log ---"; tail -n 30 /var/log/py-owui.log 2>/dev/null || true
if [ "$HRC" -ne 0 ]; then echo "hermes install failed (rc=$HRC)" >&2; exit 1; fi
if [ "$ORC" -ne 0 ]; then echo "open-webui install failed (rc=$ORC)" >&2; exit 1; fi

step "verify_hermes_cli"
${bashSingleQuote(HERMES_CLI)} --version

step "verify_open_webui_cli"
${bashSingleQuote(OPEN_WEBUI_BIN)} --help >/dev/null

step "hermes_config_dir"
install -d -m 0750 -o ${bashSingleQuote(HERMES_SYSTEM_USER)} -g ${bashSingleQuote(HERMES_SYSTEM_USER)} ${bashSingleQuote(`${HERMES_INSTALL_DIR}/${HERMES_CONFIG_SUBDIR}`)}
install -d -m 0750 -o ${bashSingleQuote(HERMES_SYSTEM_USER)} -g ${bashSingleQuote(HERMES_SYSTEM_USER)} ${bashSingleQuote(HERMES_WORKSPACE_DIR)}
${browserDeps ? buildBrowserDepsSteps() : ""}`
}

/**
 * The full Hermes stack (hermes-agent + Open WebUI) as install steps, for the
 * BYOS connect-time prebake.
 *
 * Exported rather than reimplemented so there is exactly one description of
 * how Hermes gets installed. The prebake runs these before the customer has
 * picked an engine; if they pick OpenClaw instead, the box simply carries an
 * unused Hermes venv.
 */
export function buildHermesPrebakeSteps(opts: {
  browserDeps: boolean
  pin?: string
  webuiPin?: string
}): string {
  return buildHermesPlusWebuiInstallSteps(opts.browserDeps, opts.pin, opts.webuiPin)
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
  packageName: OPEN_WEBUI_PYPI_DIST,
  registry: "pypi",
  version: OPEN_WEBUI_VERSION,
  port: OPEN_WEBUI_PORT,
  healthPath: "/health",
  dataDir: OPEN_WEBUI_DATA_DIR,
  envPath: OPEN_WEBUI_ENV_PATH,
  seedAdmin: { signupPath: "/api/v1/auths/signup" },


  /**
   * Open WebUI env. Auth is required (the public URL must not be open); RAG/STT
   * use the OpenAI engine to avoid loading local models (~500MB RAM) on small
   * boxes. Points at Hermes' loopback API with the gateway token as the key.
   * DATA_DIR holds the SQLite DB + uploads; persisting it is what makes
   * accounts/chats survive restarts.
   *
   * `DEFAULT_MODELS` is load-bearing, not a nicety. We seed the admin account
   * over the signup endpoint and immediately lock signup, so that account has no
   * prior model preference; with no instance-wide default a new chat opens with
   * nothing selected and the FIRST message is sent with no model attached. Pin it
   * to the same slug `renderInitScript` writes as Hermes' `model.default` so the
   * two can never drift.
   */
  renderEnv(args: SidecarEnvArgs): Record<string, string> {
    const env: Record<string, string> = {
      WEBUI_AUTH: "true",
      WEBUI_SECRET_KEY: args.secretKey,
      // Open WebUI marks DEFAULT_MODELS (and most admin-level settings) as
      // ConfigVar: the env value is read on the FIRST launch, persisted into the
      // SQLite DB, and every later env change is ignored in favour of the stored
      // value. That silently defeated the fix below on the primary delivery path
      // — a warm-pool VM boots the sidecar at bake time with a placeholder env
      // and no model, persists that empty default, and then ignores the real
      // model written at claim. Reprovision was defeated the same way.
      //
      // This flag is itself a normal env var, so it always applies, and it makes
      // env the single source of truth on every boot. Correct for a
      // platform-managed box: we generate this file, nobody hand-tunes it. The
      // documented trade-off is that admin-level changes made inside Open WebUI's
      // own settings UI no longer survive a restart. Per-user data — accounts,
      // chats, each user's own model choice — lives in ordinary tables and is
      // unaffected.
      ENABLE_PERSISTENT_CONFIG: "false",
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
    // Matched against the `id` Hermes returns from /v1/models (an OpenRouter
    // slug, passed through unchanged). Omitted rather than written empty when a
    // caller has no model yet (warm-pool bake), so Open WebUI keeps its own
    // default-resolution behavior instead of parsing a blank entry.
    if (args.model.trim()) env.DEFAULT_MODELS = args.model.trim()
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
  caps: RUNTIME_CAPS.hermes,
  npmPackage: HERMES_PYPI_DIST,
  registry: "pypi",
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
    return `# Generated by Atlas Agents (fallback only — Hermes manages its own config via CLI).
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
      ? buildDualRouteBody(allowed, args.upstreamPort, args.toolServices)
      : buildSingleUpstreamBody(allowed, HERMES_GATEWAY_PORT, args.toolServices)

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
    // Chrome is ~142MB and `agent-browser` needs a global npm install; both
    // are browser-tool-only. Default true preserves the old always-bake
    // behaviour for callers that have no instance to read tools from (the
    // warm pool, where bake time is ours and free).
    const browserDeps = args.browserDeps !== false
    const installSteps = args.webuiEnabled
      ? buildHermesPlusWebuiInstallSteps(
          browserDeps,
          args.runtimeVersion,
          args.sidecarVersion,
        )
      : buildHermesInstallSteps(browserDeps, args.runtimeVersion)
    return buildBootstrapFraming(
      {
        installDir: HERMES_INSTALL_DIR,
        systemUser: HERMES_SYSTEM_USER,
        minNodeVersion: HERMES_VPS_MIN_NODE,
        gatewayPort: args.gatewayPort,
        sshPort: args.sshPort,
        manageFirewall: args.manageFirewall,
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

    // Toolsets: always keep the default `hermes-cli` set and ADD the enabled
    // catalog tools on top. Setting the list is fatal (a bad toolset must fail
    // the provision, matching the config contract); the browser provider set is
    // best-effort like base_url since the exact key varies across versions.
    const toolsets = enabledToolsForRuntime(args.enabledToolIds ?? [], "hermes")
    // Host-side tools (e.g. Knowledge Base) have no Hermes toolset — skip them.
    const toolsetIds = [
      "hermes-cli",
      ...toolsets
        .map((t) => t.support.hermes?.toolset)
        .filter((s): s is string => !!s),
    ]
    const toolsetsStep = `${run(`config set toolsets ${bashSingleQuote(JSON.stringify(toolsetIds))}`)} || exit 1\n`
    const browserStep = toolsets.some((t) => t.id === "browser")
      ? `${run("config set browser.provider local")} || echo "warn: could not set browser.provider" >&2\n`
      : ""

    // Warm-pool fast path: `setup --quick` and `doctor --fix` already ran at
    // bake, so at claim we only apply the per-instance config deltas + a fast
    // `config check`. This is the single biggest saving toward the <25s target.
    const setupStep = args.skipSetupAndDoctor
      ? `echo "=== provision: hermes_setup (skipped — bake-finalized) ==="\n`
      : `echo "=== provision: hermes_setup ==="
if ! ${run("setup --non-interactive --quick")}; then
  echo "hermes setup failed" >&2
  exit 1
fi
`
    const doctorStep = args.skipSetupAndDoctor
      ? `echo "=== provision: hermes_doctor (skipped — bake-finalized) ==="\n`
      : `echo "=== provision: hermes_doctor ==="
if ! ${run("doctor --fix")}; then
  echo "hermes doctor failed" >&2
  ${run("config show")} 2>/dev/null || true
  exit 1
fi
`

    return `#!/bin/bash
set -uo pipefail

${setupStep}
echo "=== provision: hermes_config ==="
${run(`config set model.provider ${bashSingleQuote(args.provider)}`)} || exit 1
${run(`config set model.default ${bashSingleQuote(args.model)}`)} || exit 1
${baseUrlStep}${run("config set terminal.backend local")} || exit 1

echo "=== provision: hermes_toolsets ==="
${toolsetsStep}${browserStep}
echo "=== provision: hermes_config_check ==="
if ! ${run("config check")}; then
  echo "hermes config check failed" >&2
  ${run("config show")} 2>/dev/null || true
  exit 1
fi

${doctorStep}
echo "=== provision: hermes_init_done ==="
`
  },

  sidecar: openWebUiSidecar,
}
