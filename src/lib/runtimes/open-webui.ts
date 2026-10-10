import type { SidecarEnvArgs, SidecarSpec } from "./types"
import { pypiSpec } from "@/lib/runtime-versions"

/* --- Open WebUI sidecar -------------------------------------------------- */
/**
 * Open WebUI runs as a native Python process in front of a runtime's OpenAI-
 * compatible API — installed via `pip install open-webui` into its own venv,
 * supervised by systemd. It binds loopback :8080 (Caddy proxies the public host
 * here); the gateway stays loopback-only and is reached internally by Open
 * WebUI. No Docker daemon; the runtimes share the same supervision model
 * (systemd) and the same packaging style (Python venv).
 *
 * Shared by every engine that ships a chat UI (Hermes, Claude Code, Codex).
 * Lifted out of hermes.ts unchanged — Hermes' rendered output is byte-identical.
 */
export const OPEN_WEBUI_SERVICE_NAME = "open-webui"
export const OPEN_WEBUI_PORT = 8080
/**
 * The Open WebUI release new boxes install: one behind PyPI's latest
 * (0.11.4 at the time of pinning), which was a large feature release. Bump on
 * purpose after a test deploy. `OPEN_WEBUI_VERSION` overrides it.
 */
export const OPEN_WEBUI_PINNED_VERSION = "0.11.3"
export const OPEN_WEBUI_VERSION = () => process.env.OPEN_WEBUI_VERSION || OPEN_WEBUI_PINNED_VERSION
export const OPEN_WEBUI_INSTALL_DIR = "/opt/open-webui"
export const OPEN_WEBUI_VENV = "/opt/open-webui/venv"
export const OPEN_WEBUI_BIN = "/opt/open-webui/venv/bin/open-webui"
export const OPEN_WEBUI_SYSTEM_USER = "open-webui"
export const OPEN_WEBUI_DATA_DIR = "/opt/open-webui/data"
export const OPEN_WEBUI_PYPI_DIST = "open-webui"

/**
 * PyTorch's CPU-only wheel index. Open WebUI's torch comes from here instead of
 * PyPI's CUDA build — see `py_install_cpu_torch` in buildPyInstallPrelude.
 */
export const TORCH_CPU_INDEX_URL = "https://download.pytorch.org/whl/cpu"

/** Python floor shared by hermes-agent and open-webui (`requires_python >=3.11`). */
export const PYTHON_MIN = "3.11"
/** `open-webui` is `>=3.11,<3.13.0a1` — see HERMES_PYTHON_MAX_EXCLUSIVE in hermes.ts. */
export const OPEN_WEBUI_PYTHON_MAX_EXCLUSIVE = "3.13"

export function bashSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function openWebUiPipSpec(pin?: string): string {
  return pypiSpec(OPEN_WEBUI_PYPI_DIST, pin ?? OPEN_WEBUI_VERSION())
}

/**
 * `verify_python` for a given exclusive upper bound. Fails in seconds, with a
 * message naming the actual version, rather than letting a doomed install run.
 */
export function buildVerifyPythonStep(maxExclusive: string): string {
  const [maj, min] = maxExclusive.split(".")
  return `step "verify_python"
if ! python3 -c 'import sys; sys.exit(0 if (3, 11) <= sys.version_info[:2] < (${maj}, ${min}) else 1)'; then
  PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
  echo "Requires Python ${PYTHON_MIN}+ and older than ${maxExclusive}, found $PY_VER" >&2
  exit 1
fi`
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
export function buildPyInstallPrelude(): string {
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

/**
 * The Open WebUI system user, directories and venv. Requires the prelude
 * (`venv_create`) to have been emitted first. No trailing newline — callers
 * splice it into their own step sequence.
 */
export function buildOpenWebUiPrepSteps(): string {
  return `step "open_webui_user"
id ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} >/dev/null 2>&1 || useradd --system --home-dir ${bashSingleQuote(OPEN_WEBUI_INSTALL_DIR)} --shell /usr/sbin/nologin ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)}

step "open_webui_dirs"
install -d -m 0750 -o ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} -g ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} ${bashSingleQuote(OPEN_WEBUI_INSTALL_DIR)}
install -d -m 0750 -o ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} -g ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} ${bashSingleQuote(OPEN_WEBUI_DATA_DIR)}

step "open_webui_venv"
venv_create ${bashSingleQuote(OPEN_WEBUI_VENV)}
chown -R ${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)}:${bashSingleQuote(OPEN_WEBUI_SYSTEM_USER)} ${bashSingleQuote(OPEN_WEBUI_INSTALL_DIR)}`
}

/**
 * A complete, standalone Open WebUI install for engines that are not Python
 * themselves (Claude Code, Codex): apt Python, the uv/pip prelude, the venv,
 * the CPU-torch package install and a CLI check. Hermes overlaps the same
 * pieces with its own pip install instead — see hermes.ts.
 */
export function buildOpenWebUiStandaloneInstallSteps(pin?: string): string {
  return `
OPEN_WEBUI_PKG_SPEC=${bashSingleQuote(openWebUiPipSpec(pin))}

step "python_deps"
apt-get $APT_OPTS install -y python3 python3-venv python3-pip

${buildVerifyPythonStep(OPEN_WEBUI_PYTHON_MAX_EXCLUSIVE)}

${buildPyInstallPrelude()}
${buildOpenWebUiPrepSteps()}

step "install_open_webui"
py_install_cpu_torch ${bashSingleQuote(OPEN_WEBUI_VENV)} "$OPEN_WEBUI_PKG_SPEC" /var/tmp/py-cache-owui

step "verify_open_webui_cli"
${bashSingleQuote(OPEN_WEBUI_BIN)} --help >/dev/null
`
}

/**
 * Open WebUI task generation (chat titles, tags, follow-up suggestions,
 * autocomplete, search/retrieval queries) sends extra completions to the same
 * model as the chat. Against an agent harness every one of those is a full
 * agent run with tools — slow, billed, and able to touch the workspace — so the
 * CLI engines switch them all off. Hermes keeps Open WebUI's defaults.
 */
export const OPEN_WEBUI_AGENT_TASKS_OFF: Record<string, string> = {
  ENABLE_TITLE_GENERATION: "false",
  ENABLE_TAGS_GENERATION: "false",
  ENABLE_FOLLOW_UP_GENERATION: "false",
  ENABLE_AUTOCOMPLETE_GENERATION: "false",
  ENABLE_SEARCH_QUERY_GENERATION: "false",
  ENABLE_RETRIEVAL_QUERY_GENERATION: "false",
}

export type OpenWebUiSidecarOpts = {
  /** Absolute path of the sidecar env file (lives in the runtime's config dir). */
  envPath: string
  /** systemd unit the sidecar depends on (the runtime gateway, without ".service"). */
  gatewayServiceName: string
  /** `Description=` of the sidecar unit, e.g. "Open WebUI (Hermes chat UI)". */
  description: string
  /** Extra env merged over the defaults, e.g. OPEN_WEBUI_AGENT_TASKS_OFF. */
  extraEnv?: Record<string, string>
}

/**
 * Open WebUI sidecar — a native Python process (installed via pip into its own
 * venv) fronting a gateway's OpenAI-compatible API. systemd supervises it
 * directly; there is no Docker daemon, no container, no named volume. The venv
 * is isolated from the runtime so Open WebUI's chunky dep tree (chromadb,
 * sentence-transformers, etc.) can't break the runtime's pins. Reaches the
 * gateway on loopback and binds its own UI on 127.0.0.1:8080 (HOST/PORT from
 * the env file); Caddy is the only public ingress.
 */
export function makeOpenWebUiSidecar(opts: OpenWebUiSidecarOpts): SidecarSpec {
  return {
    serviceName: OPEN_WEBUI_SERVICE_NAME,
    packageName: OPEN_WEBUI_PYPI_DIST,
    registry: "pypi",
    version: OPEN_WEBUI_VERSION,
    port: OPEN_WEBUI_PORT,
    healthPath: "/health",
    dataDir: OPEN_WEBUI_DATA_DIR,
    envPath: opts.envPath,
    seedAdmin: { signupPath: "/api/v1/auths/signup" },

    /**
     * Open WebUI env. Auth is required (the public URL must not be open); RAG/STT
     * use the OpenAI engine to avoid loading local models (~500MB RAM) on small
     * boxes. Points at the gateway's loopback API with the gateway token as the
     * key. DATA_DIR holds the SQLite DB + uploads; persisting it is what makes
     * accounts/chats survive restarts.
     *
     * `DEFAULT_MODELS` is load-bearing, not a nicety. We seed the admin account
     * over the signup endpoint and immediately lock signup, so that account has no
     * prior model preference; with no instance-wide default a new chat opens with
     * nothing selected and the FIRST message is sent with no model attached. Pin it
     * to the same slug the runtime pins as its own default so the two can never
     * drift.
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
        ...opts.extraEnv,
      }
      // Matched against the `id` the gateway returns from /v1/models (an
      // OpenRouter slug, passed through unchanged). Omitted rather than written
      // empty when a caller has no model yet (warm-pool bake), so Open WebUI
      // keeps its own default-resolution behavior instead of parsing a blank entry.
      if (args.model.trim()) env.DEFAULT_MODELS = args.model.trim()
      if (args.publicUrl) env.WEBUI_URL = args.publicUrl
      return env
    },

    renderSystemdUnit(): string {
      return `[Unit]
Description=${opts.description}
After=network-online.target ${opts.gatewayServiceName}.service
Requires=${opts.gatewayServiceName}.service
Wants=network-online.target

[Service]
Type=simple
User=${OPEN_WEBUI_SYSTEM_USER}
Group=${OPEN_WEBUI_SYSTEM_USER}
WorkingDirectory=${OPEN_WEBUI_INSTALL_DIR}
EnvironmentFile=${opts.envPath}
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
}
