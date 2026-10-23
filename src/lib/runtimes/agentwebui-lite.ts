import crypto from "node:crypto"
import { BRANDING } from "@/configs/branding"
import { isPinned, npmSpec, pypiSpec } from "@/lib/runtime-versions"
import { APT_OPTS_LITERAL } from "./bootstrap"
import { bashSingleQuote, buildPyInstallPrelude, buildVerifyPythonStep } from "./python-install"
import { buildHermesAcpProviderPatch } from "./hermes-acp-patch"
import type { BootstrapRenderArgs, RuntimeEngine, SidecarEnvArgs, SidecarSpec } from "./types"

/* --- AgentWebUI Lite: the chat UI ------------------------------------------ */
/**
 * AgentWebUI Lite (github.com/SovereignML/AgentWebUI-Lite, published to PyPI as `agentwebui-lite`) is the chat page
 * every agent but OpenClaw ships. It talks to the agent over the Agent Client
 * Protocol (ACP): it starts the engine's own ACP command (`hermes acp`,
 * `opencode acp`, `gemini --acp`, `grok agent stdio`; Claude Code, Codex and Pi through
 * their ACP adapters) and streams its replies, plans, tool calls and
 * permission questions.
 *
 * It replaced Open WebUI to make installs fast: Open WebUI was most of a cold
 * install (a 146MB wheel, ~116 dependencies and torch) and of an agent's memory.
 * Lite is one dependency (`aiohttp`), starts in about a second, and has no
 * accounts to seed: its sign-in email and password are in its .env from Phase A.
 *
 * How it sits on the box:
 *  - one Python venv under /opt/agentwebui-lite, plus the ACP adapter for the
 *    CLI engines under /opt/agentwebui-lite/acp;
 *  - a systemd unit that runs AS THE RUNTIME'S USER with the runtime's own env
 *    files, because the agent processes Lite starts are the engine itself and
 *    need its sign-in, keys and workspace. Lite's own settings are NOT in the
 *    unit: Lite reads them from its .env (AWL_ENV_FILE), so they never reach
 *    the environment the agent processes inherit;
 *  - loopback :8080, where Caddy sends everything but `/v1/*` (the gateway).
 *
 * Customers chat in the dashboard, which frames the page and signs the
 * browser in with a one-time `/embed` link signed with EMBED_SECRET (only the
 * dashboard's origins may frame it: FRAME_ANCESTORS). They can also open it at
 * the agent's own address or IP and sign in with the email and password the
 * dashboard shows (LOGIN_EMAIL + PASSWORD). The model is the dashboard's
 * choice (Controls → Model rewrites AGENT_<ID>_MODEL, see liteModelId, and
 * restarts Lite; LOCK_MODEL), and the agent works only in its workspace
 * (LOCK_FOLDER).
 *
 * Agents made before Lite run Open WebUI until their box is migrated
 * (buildLiteMigrationScript); `Instance.chatUi` says which a box has.
 */

/** `Instance.chatUi` of an agent whose box runs Lite. NULL: still Open WebUI. */
export const CHAT_UI_LITE = "agentwebui-lite"

/** Whether this agent's box already runs Lite (else it still runs Open WebUI). */
export function runsLite(instance: { chatUi?: string | null }): boolean {
  return instance.chatUi === CHAT_UI_LITE
}

/** The unit an agent made before Lite still runs, until it is migrated. */
export const LEGACY_OPEN_WEBUI_SERVICE = "open-webui"

export const LITE_SERVICE_NAME = "agentwebui-lite"
/** The chat UI's loopback port: Caddy sends everything but `/v1/*` here. */
export const LITE_PORT = 8080
export const LITE_INSTALL_DIR = "/opt/agentwebui-lite"
export const LITE_VENV = `${LITE_INSTALL_DIR}/venv`
export const LITE_BIN = `${LITE_VENV}/bin/agentwebui-lite`
/** Where the CLI engines' ACP adapters are installed (npm prefix). */
export const LITE_ACP_DIR = `${LITE_INSTALL_DIR}/acp`
/** Lite's Python floor is 3.11 and it has no ceiling; this bound only fails loudly on a future 3.x. */
const LITE_PYTHON_MAX_EXCLUSIVE = "3.15"

/**
 * The Lite release new boxes install, from PyPI (`agentwebui-lite`). Lite's
 * repo (SovereignML/AgentWebUI-Lite) publishes a release when a `v*` tag is
 * pushed; bump this on purpose after a test deploy. 0.2.1: the framed sign-in
 * cookie is Partitioned on HTTPS and plain on HTTP (so signing in at the IP
 * works on a box the dashboard frames), and the page tells the dashboard
 * whether the framed sign-in took.
 */
export const LITE_PINNED_VERSION = "0.2.1"

/** pip requirement for Lite. `AGENTWEBUI_LITE_PIP_SPEC` overrides it (e.g. `agentwebui-lite==0.1.1`). */
export function litePipSpec(): string {
  return process.env.AGENTWEBUI_LITE_PIP_SPEC?.trim() || pypiSpec("agentwebui-lite", LITE_PINNED_VERSION)
}

/** What a box's Lite is, for the pool key and Instance.sidecarVersion. */
export function liteVersion(): string {
  const override = process.env.AGENTWEBUI_LITE_PIP_SPEC?.trim()
  if (!override) return LITE_PINNED_VERSION
  const pinned = override.match(/==\s*([A-Za-z0-9._+-]+)$/)?.[1]
  return pinned && isPinned(pinned) ? pinned : "custom"
}

/**
 * ACP adapters for the CLI engines, one release behind latest (the same rule
 * as the runtimes). Each brings the official SDK of its engine.
 */
export const ACP_ADAPTERS: Record<string, { pkg: string; version: string; bin: string }> = {
  "claude-code": {
    pkg: "@agentclientprotocol/claude-agent-acp",
    version: "0.93.0",
    bin: "claude-agent-acp",
  },
  codex: { pkg: "@agentclientprotocol/codex-acp", version: "2.2.1", bin: "codex-acp" },
  // Community adapter (svkozak/pi-acp): it runs `pi --mode rpc`, so Pi must be on PATH.
  pi: { pkg: "pi-acp", version: "0.0.33", bin: "pi-acp" },
}

/** Engines whose own CLI speaks ACP, with no adapter: the arguments that start it. */
const NATIVE_ACP: Record<string, string> = {
  hermes: "acp",
  opencode: "acp",
  "gemini-cli": "--acp",
  grok: "agent stdio",
}

/**
 * hermes-agent's ACP server is an optional extra (`agent-client-protocol`).
 * `messaging` comes along so a box moved to Lite also has aiohttp, which the
 * gateway's API server needs (same spec as a fresh install, hermes.ts).
 */
const HERMES_ACP_EXTRA = "hermes-agent[acp,messaging]"

/** Whether Lite can front this engine. OpenClaw keeps its own UI. */
export function liteSupports(runtimeId: string): boolean {
  return runtimeId in NATIVE_ACP || runtimeId in ACP_ADAPTERS
}

/** The ACP command Lite starts for an engine. */
export function acpCommand(engine: Pick<RuntimeEngine, "id" | "cliBinary">): string {
  if (engine.id in NATIVE_ACP) return `${engine.cliBinary} ${NATIVE_ACP[engine.id]}`
  const adapter = ACP_ADAPTERS[engine.id]
  if (!adapter) throw new Error(`AgentWebUI Lite has no ACP command for ${engine.id}`)
  return `${LITE_ACP_DIR}/node_modules/.bin/${adapter.bin}`
}

/**
 * The id an engine's ACP server knows an OpenRouter model by, which is what
 * Lite sends as the agent's model (checked against each engine's pinned release):
 *  - Hermes lists `openrouter:<slug>`, and only that prefix keeps a switch on
 *    OpenRouter (with the patch in hermes.ts; a bare slug can be taken to
 *    another provider whose catalog also lists it);
 *  - OpenCode and Pi list `openrouter/<slug>`;
 *  - Claude Code and Codex use the slug as their engine config names it;
 *  - Gemini CLI and Grok use their vendor's own model name (the slug without
 *    `google/` or `x-ai/`), as their config maps it onto OpenRouter.
 */
export function liteModelId(engineId: string, slug: string): string {
  if (engineId === "hermes") return `openrouter:${slug}`
  if (engineId === "opencode" || engineId === "pi") return `openrouter/${slug}`
  if (engineId === "gemini-cli") return slug.replace(/^google\//, "")
  if (engineId === "grok") return slug.replace(/^x-ai\//, "")
  return slug
}

/**
 * Settings Lite reads (its .env.example). A runtime env file that set one would
 * override Lite's own .env, since Lite lets the environment win.
 */
export const LITE_SETTING_KEYS = /^(HOST|PORT|PASSWORD|LOGIN_EMAIL|USER_NAME|DATA_DIR|SYSTEM_PROMPT|WORKSPACE_DIR|AGENT_IDLE_MINUTES|UPLOAD_MB|RICH_REPLIES|FILES_ROOTS|TRUST_PROXY|NOTIFY_WEBHOOK|BRAND_[A-Z_]+|EMBED_SECRET|FRAME_ANCESTORS|LOCK_MODEL|LOCK_FOLDER|PROVIDER_[A-Z0-9]+_[A-Z]+|AGENT_[A-Z0-9]+_[A-Z]+)$/

/** Lite's env-file prefix for the one agent it serves: AGENT_<ID>_COMMAND, AGENT_<ID>_NAME. */
function liteAgentKey(engine: Pick<RuntimeEngine, "id">): string {
  return `AGENT_${engine.id.replace(/[^a-z0-9]/gi, "").toUpperCase()}`
}

/**
 * The per-agent embed secret. Derived from the platform's encryption key and
 * the instance id, so the dashboard can sign `/embed` links without storing
 * anything, and every agent's secret is different.
 */
export function liteEmbedSecret(instanceId: string): string {
  const key = process.env.INSTANCE_ENCRYPTION_KEY?.trim()
  if (!key) throw new Error("INSTANCE_ENCRYPTION_KEY is not set, so no embed secret can be derived")
  return crypto.createHmac("sha256", key).update(`agentwebui-lite-embed:${instanceId}`).digest("hex")
}

/**
 * A one-time `/embed` link that signs the browser in to an agent's chat page
 * (Lite's format: base64url JSON {exp, nonce}, a dot, the hex HMAC-SHA256 of
 * that text). Lives 60 seconds; Lite accepts each link once.
 */
export function buildLiteEmbedUrl(publicUrl: string, secret: string, nowMs = Date.now()): string {
  const payload = JSON.stringify({
    exp: Math.floor(nowMs / 1000) + 60,
    nonce: crypto.randomBytes(16).toString("hex"),
  })
  const text = Buffer.from(payload, "utf8").toString("base64url")
  const signature = crypto.createHmac("sha256", secret).update(text).digest("hex")
  return `${publicUrl.replace(/\/+$/, "")}/embed?token=${text}.${signature}`
}

/**
 * Whether a Lite page lets `origin` frame it, read from the
 * Content-Security-Policy Lite puts on every response (`frame-ancestors 'self'
 * <FRAME_ANCESTORS>`). False when the header is missing.
 */
export function liteAllowsFraming(csp: string | null | undefined, origin: string): boolean {
  if (!csp) return false
  const directive = csp
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find(([name]) => name?.toLowerCase() === "frame-ancestors")
  return Boolean(directive?.slice(1).includes(origin.replace(/\/+$/, "")))
}

/**
 * Install steps for Lite and the engine's ACP side, appended to the runtime's
 * own bootstrap. `standalone` adds the Python setup (apt Python, uv, the
 * `py_install` helpers), which Hermes' bootstrap already has but a migration
 * script or a CLI engine's bootstrap does not.
 */
export function buildLiteInstallSteps(
  engine: RuntimeEngine,
  args: Pick<BootstrapRenderArgs, "runtimeVersion"> = {},
  opts: { standalone?: boolean } = {},
): string {
  const isHermes = engine.id === "hermes"
  const hermesVenv = engine.cliBinary.replace(/\/bin\/[^/]+$/, "")
  const pythonSetup =
    isHermes && !opts.standalone
      ? ""
      : `
step "python_deps"
apt-get $APT_OPTS install -y python3 python3-venv python3-pip

${buildVerifyPythonStep(LITE_PYTHON_MAX_EXCLUSIVE)}

${buildPyInstallPrelude()}`
  const adapter = ACP_ADAPTERS[engine.id]
  // A fresh Hermes install already has the `acp` extra (hermes.ts); a box
  // being migrated may predate it.
  const acpSteps = isHermes
    ? !opts.standalone
      ? ""
      : `
step "install_hermes_acp"
py_install ${bashSingleQuote(hermesVenv)} ${bashSingleQuote(pypiSpec(HERMES_ACP_EXTRA, args.runtimeVersion ?? engine.version()))} /var/tmp/py-cache-hermes
${buildHermesAcpProviderPatch(hermesVenv)}`
    : adapter
      ? `
step "install_acp_adapter"
install -d -m 0755 ${bashSingleQuote(LITE_ACP_DIR)}
npm install --prefix ${bashSingleQuote(LITE_ACP_DIR)} --omit=dev --no-audit --no-fund --loglevel=warn ${bashSingleQuote(npmSpec(adapter.pkg, adapter.version))}
chmod -R a+rX ${bashSingleQuote(LITE_ACP_DIR)}`
      : ""
  return `${pythonSetup}
step "install_agentwebui_lite"
install -d -m 0755 ${bashSingleQuote(LITE_INSTALL_DIR)}
venv_create ${bashSingleQuote(LITE_VENV)}
py_install ${bashSingleQuote(LITE_VENV)} ${bashSingleQuote(litePipSpec())} /var/tmp/py-cache-awl
chmod -R a+rX ${bashSingleQuote(LITE_INSTALL_DIR)}
${acpSteps}

step "verify_agentwebui_lite"
${bashSingleQuote(`${LITE_VENV}/bin/python`)} -c 'import agentwebui_lite'
`
}

/** Lite as a runtime's sidecar: env, unit, health. No admin to seed. */
export function makeLiteSidecar(engine: RuntimeEngine): SidecarSpec {
  const home = engine.paths.installDir
  const atlasDir = engine.paths.envPath.replace(/\/[^/]+$/, "")
  const envPath = `${atlasDir}/agentwebui-lite.env`
  const dataDir = `${atlasDir}/agentwebui-lite`
  // The CLI engines keep their per-provision model pins in a second env file.
  const modelEnvPath = engine.paths.configFileName === "model.env" ? engine.paths.configPath : null
  return {
    serviceName: LITE_SERVICE_NAME,
    port: LITE_PORT,
    healthPath: "/api/health",
    dataDir,
    envPath,
    packageName: "agentwebui-lite",
    registry: "pypi",
    version: liteVersion,

    renderEnv(args: SidecarEnvArgs): Record<string, string> {
      const name = args.instance.name || engine.displayName
      const key = liteAgentKey(engine)
      const model = args.model.trim()
      // The default first, then the rest an admin enabled for this engine.
      const models = [...new Set([model, ...(args.selectableModels ?? [])].map((s) => s.trim()))].filter(Boolean)
      const env: Record<string, string> = {
        HOST: "127.0.0.1",
        PORT: String(LITE_PORT),
        DATA_DIR: dataDir,
        // Required: the box is reachable through Caddy. The same generated
        // email and password the dashboard shows under Access.
        LOGIN_EMAIL: args.adminEmail,
        PASSWORD: args.adminPassword,
        TRUST_PROXY: "true",
        WORKSPACE_DIR: engine.paths.workspaceDir,
        FILES_ROOTS: engine.paths.workspaceDir,
        // The model is chosen in the dashboard (Controls → Model), which
        // rewrites this env and restarts Lite, so the page offers no choice:
        // one place to change it, and every new chat starts on it.
        LOCK_MODEL: "true",
        LOCK_FOLDER: "true",
        // No AGENT_IDLE_MINUTES: Lite 0.1.0 reads any AGENT_<ID>_<FIELD> key
        // as an agent, so it takes that one for an agent "idle" with no
        // command and exits at start. Lite's default (10 minutes) applies.
        [`${key}_COMMAND`]: acpCommand(engine),
        [`${key}_NAME`]: name,
        // The page keeps its own name, carries our logo, and calls the one
        // signed-in user Admin (Lite's sidebar says "You" without a name).
        BRAND_NAME: LITE_BRAND_NAME,
        USER_NAME: LITE_USER_NAME,
      }
      const logo = liteBrandLogo()
      if (logo) env.BRAND_LOGO = logo
      if (args.selectableModels?.length) {
        if (model) env[`${key}_MODEL`] = liteModelId(engine.id, model)
        env[`${key}_MODELS`] = models.map((s) => liteModelId(engine.id, s)).join(",")
      }
      // The dashboard shows this page in a frame and signs the browser in with
      // a one-time /embed link (see buildLiteEmbedUrl). Lite needs both keys;
      // without them the page still works at the agent's own address.
      const ancestors = (args.frameAncestors ?? []).filter((o) => /^https?:\/\/[^/\s]+$/.test(o))
      if (args.embedSecret && ancestors.length > 0) {
        env.EMBED_SECRET = args.embedSecret
        env.FRAME_ANCESTORS = ancestors.join(" ")
      }
      // Read by nothing in Lite; recorded so a reprovision can tell whether the
      // model moved and Lite (whose agents inherit the engine's config at
      // start) needs a restart.
      if (model) env.ATLAS_PINNED_MODEL = model
      return env
    },

    renderSystemdUnit(): string {
      // Only the runtime's env goes into the process environment: the agents
      // Lite starts inherit it and need those keys. Lite's settings (sign-in
      // email and password) stay in its .env, read through AWL_ENV_FILE, so no agent
      // sees them. The environment wins over Lite's .env, so the runtime's
      // files must not set a key Lite reads (see LITE_SETTING_KEYS).
      return `[Unit]
Description=AgentWebUI Lite (${engine.displayName} chat UI)
After=network-online.target ${engine.serviceName}.service
Wants=network-online.target

[Service]
Type=simple
User=${engine.paths.systemUser}
Group=${engine.paths.systemUser}
WorkingDirectory=${home}
Environment=HOME=${home}
EnvironmentFile=${engine.paths.envPath}
${modelEnvPath ? `EnvironmentFile=-${modelEnvPath}\n` : ""}Environment=AWL_ENV_FILE=${envPath}
ExecStart=${LITE_BIN}
Restart=always
RestartSec=3
TimeoutStartSec=60

[Install]
WantedBy=multi-user.target
`
    },
  }
}

/** The chat page's name, as Lite ships it. */
export const LITE_BRAND_NAME = "AgentWebUI"
/** What the chat page calls its one signed-in user. */
export const LITE_USER_NAME = "Admin"

/**
 * The Atlas Agents mark for the chat page's header, served by the dashboard
 * (the white mark: Lite opens in its dark theme). Lite fetches it in the
 * browser, so it must be a public https URL; absent otherwise (dev), and Lite
 * shows its built-in logo.
 */
export function liteBrandLogo(appUrl: string = BRANDING.appUrl): string | undefined {
  if (!/^https:\/\//.test(appUrl)) return undefined
  return `${appUrl.replace(/\/+$/, "")}/assets/icons/SovereignML-logo-white.svg`
}

/**
 * Bash that removes Open WebUI from a box: its unit, its whole install under
 * /opt/open-webui (venv, data and chat history), its env file next to any
 * runtime's own, and its system user. Idempotent, and a no-op on a box that
 * never had it. Never fails the script it is part of.
 *
 * Only run it when no agent on the box still uses Open WebUI: the provisioner
 * checks that for BYOS servers, which can host several agents.
 */
export function buildOpenWebuiRemovalSteps(): string {
  const svc = LEGACY_OPEN_WEBUI_SERVICE
  return `systemctl disable --now ${svc} >/dev/null 2>&1 || true
rm -f /etc/systemd/system/${svc}.service
systemctl daemon-reload >/dev/null 2>&1 || true
rm -rf /opt/open-webui
rm -f /opt/*/.hermes/open-webui.env /opt/*/.atlas/open-webui.env
if id ${svc} >/dev/null 2>&1; then userdel ${svc} >/dev/null 2>&1 || true; fi`
}

/** Printed by the migration script once Lite answers on the box. */
export const LITE_MIGRATED = "LITE_MIGRATED"

/**
 * Move a box made before Lite from Open WebUI to Lite: install Lite, write its
 * env and unit, then stop and delete Open WebUI (its chats go with it) and
 * start Lite on the port Open WebUI had. Lite is installed BEFORE Open WebUI is
 * touched, so a failed install leaves the old chat UI working. Exits non-zero
 * on failure; prints LITE_MIGRATED once Lite answers.
 */
export function buildLiteMigrationScript(
  engine: RuntimeEngine,
  opts: { envB64: string },
): string {
  const sidecar = engine.sidecar
  if (!sidecar) throw new Error(`${engine.id} has no chat UI to migrate`)
  const user = bashSingleQuote(engine.paths.systemUser)
  const unitB64 = Buffer.from(sidecar.renderSystemdUnit(), "utf8").toString("base64")
  return `#!/bin/bash
set -euo pipefail
export SYSTEMD_PAGER=cat
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
APT_OPTS="${APT_OPTS_LITERAL}"
step() { echo "=== migrate: $1 ==="; }
${buildLiteInstallSteps(engine, {}, { standalone: true })}
step "write_lite_env"
echo ${bashSingleQuote(opts.envB64)} | base64 -d > ${bashSingleQuote(sidecar.envPath)}
chmod 600 ${bashSingleQuote(sidecar.envPath)}
chown ${user}:${user} ${bashSingleQuote(sidecar.envPath)}

step "write_lite_unit"
echo ${bashSingleQuote(unitB64)} | base64 -d > "/etc/systemd/system/${sidecar.serviceName}.service"

step "remove_open_webui"
${buildOpenWebuiRemovalSteps()}

step "start_lite"
systemctl daemon-reload
systemctl enable ${sidecar.serviceName}
systemctl restart ${sidecar.serviceName}
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${sidecar.port}${sidecar.healthPath}"; then
    echo ${LITE_MIGRATED}
    exit 0
  fi
  sleep 1
done
echo "AgentWebUI Lite did not answer on :${sidecar.port} after 30s" >&2
journalctl -u ${sidecar.serviceName} --no-pager -n 50 >&2 || true
exit 1
`
}
