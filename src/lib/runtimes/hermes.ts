import { buildBootstrapFraming, browserInstallStep } from "./bootstrap"
import type {
  BootstrapRenderArgs,
  BuildEnvArgs,
  RenderCaddyfileArgs,
  RenderConfigArgs,
  RenderInitScriptArgs,
  RuntimeEngine,
} from "./types"
import { buildGatewayAllowedOrigins } from "@/lib/instance-gateway-access"
import { pypiSpec } from "@/lib/runtime-versions"
import { bashSingleQuote, buildPyInstallPrelude, buildVerifyPythonStep } from "./python-install"
import { buildLiteInstallSteps, makeLiteSidecar } from "./agentwebui-lite"
import { buildHermesAcpProviderPatch } from "./hermes-acp-patch"
import { resolveLlmProvider, nvidiaKeyForSlot } from "@/lib/model-router"
import { enabledToolsForRuntime } from "@/configs/agent-tools"
import { renderGatewayCaddyfile } from "./caddy-gateway"
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
 * `hermes-agent` is `>=3.11,<3.14`.
 *
 * The bootstrap only ever checked the FLOOR. That is harmless on a managed VPS
 * (Ubuntu 24.04, Python 3.12) but not on BYOS, where the preflight admits any
 * amd64 Ubuntu or Debian with no release restriction — and Debian 13 and
 * Ubuntu 25.x ship Python 3.13. Those boxes sailed past verify_python and then
 * died several minutes later at `install_pkgs_parallel`, after the apt work,
 * the venvs and most of a 900s timeout had already been spent.
 */
export const HERMES_PYTHON_MAX_EXCLUSIVE = "3.14"

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

/**
 * hermes-agent with its `acp` extra (`agent-client-protocol`): `hermes acp` is
 * how the chat UI (AgentWebUI Lite) talks to it. One install, not two.
 */
function pipPackageSpec(pin?: string): string {
  return pypiSpec(`${HERMES_PYPI_DIST}[acp]`, pin ?? HERMES_VERSION())
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

${buildHermesAcpProviderPatch(HERMES_VENV)}

step "hermes_config_dir"
install -d -m 0750 -o ${bashSingleQuote(HERMES_SYSTEM_USER)} -g ${bashSingleQuote(HERMES_SYSTEM_USER)} ${bashSingleQuote(`${HERMES_INSTALL_DIR}/${HERMES_CONFIG_SUBDIR}`)}
install -d -m 0750 -o ${bashSingleQuote(HERMES_SYSTEM_USER)} -g ${bashSingleQuote(HERMES_SYSTEM_USER)} ${bashSingleQuote(HERMES_WORKSPACE_DIR)}
${browserDeps ? buildBrowserDepsSteps() : ""}`
}

/**
 * Hermes as install steps, for the BYOS connect-time prebake. The chat UI
 * (AgentWebUI Lite) is small and installed by the deploy itself.
 *
 * Exported rather than reimplemented so there is exactly one description of
 * how Hermes gets installed. The prebake runs these before the customer has
 * picked an engine; if they pick OpenClaw instead, the box simply carries an
 * unused Hermes venv.
 */
export function buildHermesPrebakeSteps(opts: { browserDeps: boolean; pin?: string }): string {
  return buildHermesInstallSteps(opts.browserDeps, opts.pin)
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
   * allowed-origins field): `/v1/*` to Hermes :8642, everything else to the
   * chat UI when the sidecar is on. See renderGatewayCaddyfile.
   */
  renderCaddyfile(args: RenderCaddyfileArgs): string {
    return renderGatewayCaddyfile(args, { gatewayPort: HERMES_GATEWAY_PORT })
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

  renderInstallSteps(args: BootstrapRenderArgs): string {
    // Hermes, then its chat UI (AgentWebUI Lite) when the sidecar is on.
    // Chrome is ~142MB and `agent-browser` needs a global npm install; both
    // are browser-tool-only. Default true preserves the old always-bake
    // behaviour for callers that have no instance to read tools from (the
    // warm pool, where bake time is ours and free).
    const browserDeps = args.browserDeps !== false
    return (
      buildHermesInstallSteps(browserDeps, args.runtimeVersion) +
      (args.webuiEnabled ? buildLiteInstallSteps(hermesRuntime, args) : "")
    )
  },

  renderBootstrap(args: BootstrapRenderArgs): string {
    const installSteps = hermesRuntime.renderInstallSteps!(args)
    return buildBootstrapFraming(
      {
        installDir: HERMES_INSTALL_DIR,
        systemUser: HERMES_SYSTEM_USER,
        minNodeVersion: HERMES_VPS_MIN_NODE,
        gatewayPort: args.gatewayPort,
        sshPort: args.sshPort,
        manageFirewall: args.manageFirewall,
      },
      `${installSteps}${args.extraInstallSteps ?? ""}`,
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

    // What `/v1/models` advertises to API clients. Unset, Hermes lists a
    // single id, `hermes-agent`, instead of the model's real slug. `model_name` advertises the default under its real slug;
    // each `model_routes` alias maps a slug the UI sends as `model` to that
    // model for that request (any other value falls back to `model.default`).
    // Written with the venv's PyYAML because `config set` splits keys on dots
    // and slugs contain them (`z-ai/glm-5.1`). Best-effort: a failure costs the
    // picker, not the agent.
    const routes =
      args.provider === "openrouter"
        ? [...new Set(args.selectableModels ?? [])].filter((s) => s && s !== args.model)
        : []
    const apiModels = JSON.stringify({ default: args.model, provider: args.provider, routes })
    const python = args.cliBinary.replace(/[^/]+$/, "python")
    const modelsStep = `sudo -u ${bashSingleQuote(args.systemUser)} env HOME=${bashSingleQuote(args.installDir)} HERMES_API_MODELS=${bashSingleQuote(apiModels)} ${bashSingleQuote(python)} - <<'PY' || echo "warn: could not write api_server model routes" >&2
import json, os, yaml
spec = json.loads(os.environ["HERMES_API_MODELS"])
path = os.path.join(os.environ["HOME"], ${JSON.stringify(HERMES_CONFIG_SUBDIR)}, "config.yaml")
with open(path, encoding="utf-8") as f:
    cfg = yaml.safe_load(f) or {}
def node(parent, key):
    if not isinstance(parent.get(key), dict):
        parent[key] = {}
    return parent[key]
extra = node(node(node(cfg, "platforms"), "api_server"), "extra")
extra["model_name"] = spec["default"]
extra["model_routes"] = {s: {"model": s, "provider": spec["provider"]} for s in spec["routes"]}
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    yaml.safe_dump(cfg, f, sort_keys=False)
os.chmod(tmp, os.stat(path).st_mode & 0o777)
os.replace(tmp, path)
PY
`

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
echo "=== provision: hermes_api_models ==="
${modelsStep}
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

}

// Lite reads the engine's paths, user and ACP command, so it is made from it.
hermesRuntime.sidecar = makeLiteSidecar(hermesRuntime)
