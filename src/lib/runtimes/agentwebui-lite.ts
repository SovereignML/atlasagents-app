import crypto from "node:crypto"
import { isPinned, npmSpec, pypiSpec } from "@/lib/runtime-versions"
import {
  OPEN_WEBUI_PORT,
  bashSingleQuote,
  buildPyInstallPrelude,
  buildVerifyPythonStep,
} from "./open-webui"
import type { BootstrapRenderArgs, RuntimeEngine, SidecarEnvArgs, SidecarSpec } from "./types"

/* --- AgentWebUI Lite: the light chat UI ----------------------------------- */
/**
 * AgentWebUI Lite (github.com/HackersHostel/AgentWebUI-Lite) is a small chat
 * page that talks to agents over the Agent Client Protocol (ACP): it starts
 * the engine's own ACP command (`hermes acp`, Claude Code / Codex through their
 * ACP adapters) and streams its replies, plans, tool calls and permission
 * questions. It replaces Open WebUI for new agents when `CHAT_UI=agentwebui-lite`.
 *
 * Why: Open WebUI is most of a cold install (a 146MB wheel, ~116 dependencies
 * and torch) and of an agent's memory (the footprints size it at 3GB). Lite is
 * one dependency (`aiohttp`), starts in about a second, and has no accounts to
 * seed: its password and embed secret are written into its env at provision.
 *
 * How it sits on the box:
 *  - one Python venv under /opt/agentwebui-lite, plus the ACP adapter for the
 *    CLI engines under /opt/agentwebui-lite/acp;
 *  - a systemd unit that runs AS THE RUNTIME'S USER with the runtime's own env
 *    files, because the agent processes Lite starts are the engine itself and
 *    need its sign-in, keys and workspace. Lite's own settings are NOT in the
 *    unit: Lite reads them from its .env (AWL_ENV_FILE), so they never reach
 *    the environment the agent processes inherit;
 *  - loopback :8080, the port Open WebUI used, so Caddy routes it unchanged
 *    (`/v1/*` → the gateway, everything else → the chat page).
 *
 * The dashboard frames it: Lite only lets the dashboard's origins frame it
 * (FRAME_ANCESTORS), and the dashboard signs the browser in with a one-time
 * `/embed` link signed with EMBED_SECRET (see buildLiteEmbedUrl). The model is
 * the dashboard's choice (LOCK_MODEL) and the agent works only in its
 * workspace (LOCK_FOLDER).
 */

export const CHAT_UI_OPEN_WEBUI = "open-webui"
export const CHAT_UI_LITE = "agentwebui-lite"
export type ChatUi = typeof CHAT_UI_OPEN_WEBUI | typeof CHAT_UI_LITE

/**
 * The chat UI new agents get. Open WebUI unless `CHAT_UI=agentwebui-lite`.
 * Existing agents keep the one recorded on their row (`Instance.chatUi`).
 */
export function platformChatUi(): ChatUi {
  return process.env.CHAT_UI?.trim() === CHAT_UI_LITE ? CHAT_UI_LITE : CHAT_UI_OPEN_WEBUI
}

/** A row's chat UI. NULL is every agent made before the column existed: Open WebUI. */
export function chatUiOf(instance: { chatUi?: string | null }): ChatUi {
  return instance.chatUi === CHAT_UI_LITE ? CHAT_UI_LITE : CHAT_UI_OPEN_WEBUI
}

export const LITE_SERVICE_NAME = "agentwebui-lite"
/** Same loopback port as Open WebUI, so Caddy's routing does not change. */
export const LITE_PORT = OPEN_WEBUI_PORT
export const LITE_INSTALL_DIR = "/opt/agentwebui-lite"
export const LITE_VENV = `${LITE_INSTALL_DIR}/venv`
export const LITE_BIN = `${LITE_VENV}/bin/agentwebui-lite`
/** Where the CLI engines' ACP adapters are installed (npm prefix). */
export const LITE_ACP_DIR = `${LITE_INSTALL_DIR}/acp`

/**
 * The Lite commit new boxes install. Lite is not on PyPI, so this is a git
 * install, and the repository must be readable from the box (public, or
 * published to PyPI and named in AGENTWEBUI_LITE_PIP_SPEC).
 */
export const LITE_PINNED_COMMIT = "79e1c51757acc154e4c19c6d21f3e9e2ceaf2518"
export const LITE_REPO = "https://github.com/HackersHostel/AgentWebUI-Lite"

/** pip requirement for Lite. `AGENTWEBUI_LITE_PIP_SPEC` overrides it (e.g. `agentwebui-lite==1.2.0`). */
export function litePipSpec(): string {
  return (
    process.env.AGENTWEBUI_LITE_PIP_SPEC?.trim() ||
    `agentwebui-lite @ git+${LITE_REPO}@${LITE_PINNED_COMMIT}`
  )
}

/** What a box's Lite is, for the pool key and Instance.sidecarVersion. */
export function liteVersion(): string {
  const override = process.env.AGENTWEBUI_LITE_PIP_SPEC?.trim()
  if (!override) return `git-${LITE_PINNED_COMMIT.slice(0, 12)}`
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
}

/** hermes-agent's ACP server is an optional extra (`agent-client-protocol`). */
const HERMES_ACP_EXTRA = "hermes-agent[acp]"

/** Whether Lite can front this engine. OpenClaw keeps its own UI. */
export function liteSupports(runtimeId: string): boolean {
  return runtimeId === "hermes" || runtimeId in ACP_ADAPTERS
}

/** The ACP command Lite starts for an engine. */
export function acpCommand(engine: Pick<RuntimeEngine, "id" | "cliBinary">): string {
  if (engine.id === "hermes") return `${engine.cliBinary} acp`
  const adapter = ACP_ADAPTERS[engine.id]
  if (!adapter) throw new Error(`AgentWebUI Lite has no ACP command for ${engine.id}`)
  return `${LITE_ACP_DIR}/node_modules/.bin/${adapter.bin}`
}

/**
 * Settings Lite reads (its .env.example). A runtime env file that set one would
 * override Lite's own .env, since Lite lets the environment win.
 */
export const LITE_SETTING_KEYS = /^(HOST|PORT|PASSWORD|USER_NAME|DATA_DIR|SYSTEM_PROMPT|WORKSPACE_DIR|AGENT_IDLE_MINUTES|UPLOAD_MB|RICH_REPLIES|FILES_ROOTS|TRUST_PROXY|NOTIFY_WEBHOOK|BRAND_[A-Z_]+|EMBED_SECRET|FRAME_ANCESTORS|LOCK_MODEL|LOCK_FOLDER|PROVIDER_[A-Z0-9]+_[A-Z]+|AGENT_[A-Z0-9]+_[A-Z]+)$/

/** Lite's env-file key for the one agent it serves. */
const LITE_AGENT_KEY = "AGENT"

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
 * Install steps for Lite and the engine's ACP side, appended to the runtime's
 * own bootstrap in place of Open WebUI's.
 */
export function buildLiteInstallSteps(engine: RuntimeEngine, args: BootstrapRenderArgs): string {
  const isHermes = engine.id === "hermes"
  const hermesVenv = engine.cliBinary.replace(/\/bin\/[^/]+$/, "")
  // Hermes already defined python, uv and py_install; the CLI engines have not.
  const pythonSetup = isHermes
    ? ""
    : `
step "python_deps"
apt-get $APT_OPTS install -y python3 python3-venv python3-pip git

${buildVerifyPythonStep("3.15")}

${buildPyInstallPrelude()}`
  const adapter = ACP_ADAPTERS[engine.id]
  const acpSteps = isHermes
    ? `
step "install_hermes_acp"
py_install ${bashSingleQuote(hermesVenv)} ${bashSingleQuote(pypiSpec(HERMES_ACP_EXTRA, args.runtimeVersion ?? engine.version()))} /var/tmp/py-cache-hermes`
    : adapter
      ? `
step "install_acp_adapter"
install -d -m 0755 ${bashSingleQuote(LITE_ACP_DIR)}
npm install --prefix ${bashSingleQuote(LITE_ACP_DIR)} --omit=dev --no-audit --no-fund --loglevel=warn ${bashSingleQuote(npmSpec(adapter.pkg, adapter.version))}
chmod -R a+rX ${bashSingleQuote(LITE_ACP_DIR)}`
      : ""
  return `${pythonSetup}
step "install_agentwebui_lite"
command -v git >/dev/null 2>&1 || apt-get $APT_OPTS install -y git
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
      const env: Record<string, string> = {
        HOST: "127.0.0.1",
        PORT: String(LITE_PORT),
        DATA_DIR: dataDir,
        // Required: the box is reachable through Caddy. The dashboard signs in
        // with EMBED_SECRET; the password is the fallback for the direct URL.
        PASSWORD: args.adminPassword || args.secretKey,
        EMBED_SECRET: args.secretKey,
        TRUST_PROXY: "true",
        WORKSPACE_DIR: engine.paths.workspaceDir,
        FILES_ROOTS: engine.paths.workspaceDir,
        LOCK_MODEL: "true",
        LOCK_FOLDER: "true",
        AGENT_IDLE_MINUTES: "30",
        [`${LITE_AGENT_KEY}_${engine.id.replace(/[^a-z0-9]/gi, "").toUpperCase()}_COMMAND`]: acpCommand(engine),
        [`${LITE_AGENT_KEY}_${engine.id.replace(/[^a-z0-9]/gi, "").toUpperCase()}_NAME`]:
          args.instance.name || engine.displayName,
        BRAND_NAME: (args.instance.name || engine.displayName).slice(0, 40),
      }
      const ancestors = (args.frameAncestors ?? []).filter((o) => /^https?:\/\//.test(o))
      if (ancestors.length > 0) env.FRAME_ANCESTORS = ancestors.join(" ")
      return env
    },

    renderSystemdUnit(): string {
      // Only the runtime's env goes into the process environment: the agents
      // Lite starts inherit it and need those keys. Lite's settings (password,
      // embed secret) stay in its .env, read through AWL_ENV_FILE, so no agent
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

/**
 * The engine an agent with Lite runs: the same engine, with Lite as its sidecar
 * and Lite's install steps in place of Open WebUI's. Everything that reads
 * `runtime.sidecar` (env, unit, health, Caddy upstream) then follows.
 */
export function withChatUi(engine: RuntimeEngine, chatUi: ChatUi): RuntimeEngine {
  if (chatUi !== CHAT_UI_LITE || !engine.sidecar || !liteSupports(engine.id)) return engine
  return {
    ...engine,
    sidecar: makeLiteSidecar(engine),
    renderBootstrap(args: BootstrapRenderArgs): string {
      if (!args.webuiEnabled) return engine.renderBootstrap(args)
      return engine.renderBootstrap({
        ...args,
        webuiEnabled: false,
        extraInstallSteps: `${args.extraInstallSteps ?? ""}${buildLiteInstallSteps(engine, args)}`,
      })
    },
  }
}
