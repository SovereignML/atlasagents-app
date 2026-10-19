import crypto from "node:crypto"
import { isSafeVersion, npmSpec } from "@/lib/runtime-versions"
import { buildBootstrapFraming } from "./bootstrap"
import { renderGatewayCaddyfile } from "./caddy-gateway"
import {
  CLI_GATEWAY_DIR,
  CLI_GATEWAY_FILE,
  CLI_GATEWAY_SOURCE,
  cliGatewayPackageJson,
} from "./cli-gateway"
import { RUNTIME_CAPS } from "./labels"
import {
  OPEN_WEBUI_AGENT_TASKS_OFF,
  bashSingleQuote,
  buildOpenWebUiStandaloneInstallSteps,
  makeOpenWebUiSidecar,
} from "./open-webui"
import type {
  BootstrapRenderArgs,
  BuildEnvArgs,
  RenderCaddyfileArgs,
  RenderConfigArgs,
  RenderInitScriptArgs,
  RuntimeEngine,
  TerminalSpec,
} from "./types"

/**
 * Shared engine for coding-agent CLIs (Claude Code, Codex). They have no
 * server of their own, so each box runs:
 *
 *   <id>-gateway   the Atlas CLI gateway (cli-gateway.ts) on loopback — an
 *                  OpenAI-compatible /v1 that drives the CLI through its SDK
 *   open-webui     the same chat UI sidecar Hermes uses, pointed at the gateway
 *   <id>-terminal  ttyd + tmux serving the CLI's own TUI at /terminal, behind
 *                  Caddy `forward_auth` against the gateway (the chat UI login)
 *
 * Layout under the install dir (= the system user's HOME):
 *   gateway/        root-owned: gateway.mjs, terminal.sh, the pinned SDK
 *   .atlas/.env     the runtime env (written by the provisioner, Phase A)
 *   .atlas/model.env  per-provision model pins (written by the init script)
 *   .atlas/workspace  the agent's working directory (AGENTS.md, knowledge/)
 *   .atlas/sessions.json  conversation → harness session map
 *
 * Everything the agent does, it does as that unprivileged system user — no
 * sudo. That user is the fence, which is why the harness runs with its own
 * permission prompts off (nobody is there to answer them).
 */

const ATLAS_SUBDIR = ".atlas"
/** Loopback port ttyd binds; Caddy routes `/terminal*` here after auth. */
export const CLI_TERMINAL_PORT = 7681
export const CLI_TERMINAL_PATH = "/terminal"
/** Gateway path Caddy's `forward_auth` asks before letting `/terminal` through. */
export const CLI_TERMINAL_AUTH_PATH = "/_atlas/terminal-auth"
/** Same Node floor as OpenClaw and Hermes: one Node major serves every box. */
export const CLI_VPS_MIN_NODE = "24.16.0"

export type CliRuntimeSpec = {
  id: "claude-code" | "codex"
  displayName: string
  /** The CLI users run in the terminal, installed globally with npm. */
  cliPackage: string
  cliVersion: () => string
  /** Absolute path of the globally installed CLI (NodeSource prefix is /usr). */
  cliBinary: string
  /** The SDK the gateway drives, installed (pinned) into `<installDir>/gateway`. */
  sdkPackage: string
  sdkVersion: () => string
  gatewayPort: number
  installDir: string
  systemUser: string
  /** Engine-specific `.env` keys (endpoints, auth, telemetry switches). */
  engineEnv(args: { openRouterApiKey: string; installDir: string }): Record<string, string>
  /**
   * Engine-specific keys for `.atlas/model.env`, which the init script rewrites
   * on every (re)provision so a model change reaches the gateway and terminal.
   */
  modelEnv(model: string): Record<string, string>
  /**
   * Root bash, run inside the init script, that writes the engine's own config
   * files under the user's HOME. Must be idempotent and must not put secrets on
   * a command line.
   */
  renderEngineConfig(args: { model: string; installDir: string; workspaceDir: string; systemUser: string }): string
}

/**
 * An env pin override, if it is usable: `latest`, or a version made of the
 * characters registries publish. Anything else (an empty string, or junk like
 * "2.1.296 (Claude Code)") is ignored so the code pin stands.
 */
export function pinOverride(value: string | undefined): string | undefined {
  const v = value?.trim()
  if (!v) return undefined
  return v === "latest" || isSafeVersion(v) ? v : undefined
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex")
}

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64")
}

/** `KEY=value` lines for a systemd EnvironmentFile; values are single-line. */
function renderModelEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v.replace(/[\r\n]/g, "")}`)
    .join("\n") + "\n"
}

/**
 * Caddy block for the browser terminal. Spliced ahead of `/v1/*` (first line
 * unindented, 2-space base). `forward_auth` exists in every Caddy we can end up
 * with — the pinned 2.11 release and the distro's 2.6.2 fallback — unlike
 * `basic_auth`, whose name and hash format changed in between.
 */
export function renderTerminalCaddyHandle(gatewayPort: number): string {
  return `handle ${CLI_TERMINAL_PATH}* {
    forward_auth localhost:${gatewayPort} {
      uri ${CLI_TERMINAL_AUTH_PATH}
    }
    reverse_proxy localhost:${CLI_TERMINAL_PORT} {
      header_up Host {host}
      header_up X-Real-IP {remote_host}
    }
  }`
}

export function createCliRuntime(spec: CliRuntimeSpec): RuntimeEngine {
  const atlasDir = `${spec.installDir}/${ATLAS_SUBDIR}`
  const gatewayDir = `${spec.installDir}/${CLI_GATEWAY_DIR}`
  const workspaceDir = `${atlasDir}/workspace`
  const envPath = `${atlasDir}/.env`
  const modelEnvPath = `${atlasDir}/model.env`
  const serviceName = `${spec.id}-gateway`
  const terminalServiceName = `${spec.id}-terminal`
  const terminalLauncher = `${gatewayDir}/terminal.sh`
  const user = bashSingleQuote(spec.systemUser)

  const sidecar = makeOpenWebUiSidecar({
    envPath: `${atlasDir}/open-webui.env`,
    gatewayServiceName: serviceName,
    description: `Open WebUI (${spec.displayName} chat UI)`,
    extraEnv: OPEN_WEBUI_AGENT_TASKS_OFF,
  })

  const terminal: TerminalSpec = {
    serviceName: terminalServiceName,
    port: CLI_TERMINAL_PORT,
    healthPath: `${CLI_TERMINAL_PATH}/`,
    renderSystemdUnit(): string {
      return `[Unit]
Description=${spec.displayName} browser terminal (ttyd)
After=network-online.target ${serviceName}.service
Wants=network-online.target

[Service]
Type=simple
User=${spec.systemUser}
Group=${spec.systemUser}
WorkingDirectory=${workspaceDir}
EnvironmentFile=${envPath}
EnvironmentFile=-${modelEnvPath}
Environment=HOME=${spec.installDir}
Environment=SHELL=/bin/bash
Environment=TERM=xterm-256color
ExecStart=/usr/bin/ttyd --interface lo --port ${CLI_TERMINAL_PORT} --base-path ${CLI_TERMINAL_PATH} --writable --terminal-type xterm-256color ${terminalLauncher}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
`
    },
  }

  function buildEnv(args: BuildEnvArgs): Record<string, string> {
    const env: Record<string, string> = {
      ATLAS_ENGINE: spec.id,
      // API_SERVER_* is Hermes' naming; reusing it keeps the provisioner's
      // `/v1/models` check (which sources this file) engine-agnostic.
      API_SERVER_HOST: "127.0.0.1",
      API_SERVER_PORT: String(spec.gatewayPort),
      API_SERVER_KEY: args.gatewayToken,
      ATLAS_WORKSPACE: workspaceDir,
      ATLAS_SESSIONS_PATH: `${atlasDir}/sessions.json`,
      OPENROUTER_API_KEY: args.openRouterApiKey,
      INSTANCE_ID: args.instance.id,
      DOMAIN: args.instance.domain ?? "",
      ...spec.engineEnv({ openRouterApiKey: args.openRouterApiKey, installDir: spec.installDir }),
    }
    // The terminal shares the chat UI's admin login. Only its sha256 lands on
    // the box (the password is 24 random characters, so a fast hash is enough);
    // without credentials the gateway refuses every terminal request.
    if (args.adminEmail && args.adminPassword) {
      env.TERMINAL_AUTH_USER = args.adminEmail
      env.TERMINAL_AUTH_SHA256 = sha256Hex(args.adminPassword)
    }
    return env
  }

  return {
    id: spec.id,
    displayName: spec.displayName,
    caps: RUNTIME_CAPS[spec.id],
    npmPackage: spec.cliPackage,
    registry: "npm",
    version: spec.cliVersion,
    minNode: CLI_VPS_MIN_NODE,
    gatewayPort: spec.gatewayPort,
    serviceName,
    cliBinary: spec.cliBinary,
    gatewayArgs: `${gatewayDir}/${CLI_GATEWAY_FILE}`,
    healthPath: "/health",
    // The init script writes the engine's config itself; nothing hand-rendered.
    managesOwnConfig: true,
    paths: {
      installDir: spec.installDir,
      configSubdir: ATLAS_SUBDIR,
      configFileName: "model.env",
      configPath: modelEnvPath,
      workspaceDir,
      envPath,
      systemUser: spec.systemUser,
    },

    buildEnv,

    /** Unused (`managesOwnConfig`): the model pins live in model.env. */
    renderConfig(args: RenderConfigArgs): string {
      return renderModelEnv({ ATLAS_MODEL: args.model, ...spec.modelEnv(args.model) })
    },

    renderCaddyfile(args: RenderCaddyfileArgs): string {
      return renderGatewayCaddyfile(args, {
        gatewayPort: spec.gatewayPort,
        extraHandles: renderTerminalCaddyHandle(spec.gatewayPort),
      })
    },

    renderSystemdUnit(): string {
      return `[Unit]
Description=${spec.displayName} gateway (Atlas)
After=network-online.target
Wants=network-online.target
# Trip into "failed" after repeated rapid crashes instead of looping forever —
# the provisioner's NRestarts/crash-loop check then surfaces it as a failure.
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=${spec.systemUser}
Group=${spec.systemUser}
WorkingDirectory=${gatewayDir}
EnvironmentFile=${envPath}
EnvironmentFile=-${modelEnvPath}
Environment=HOME=${spec.installDir}
Environment=NODE_ENV=production
ExecStart=/usr/bin/node ${gatewayDir}/${CLI_GATEWAY_FILE}
Restart=always
RestartSec=3
TimeoutStartSec=60

[Install]
WantedBy=multi-user.target
`
    },

    renderBootstrap(args: BootstrapRenderArgs): string {
      const cliSpec = npmSpec(spec.cliPackage, args.runtimeVersion ?? spec.cliVersion())
      const sdkVersion = spec.sdkVersion()
      const pkgJson = cliGatewayPackageJson({ [spec.sdkPackage]: sdkVersion })
      const installSteps = `
CLI_PKG_SPEC=${bashSingleQuote(cliSpec)}

# npm_retry <description> <command...> — 3 attempts with backoff. EBADENGINE is
# deterministic (the package does not support this Node), so it is not retried.
npm_retry() {
  local what="$1" max=3 a=1 out
  shift
  out="$(mktemp)"
  while [ "$a" -le "$max" ]; do
    echo "=== $what: attempt $a/$max ==="
    if "$@" 2>&1 | tee "$out"; then rm -f "$out"; return 0; fi
    if grep -q "EBADENGINE" "$out"; then
      echo "npm refused $what for this Node version (EBADENGINE) — not retrying."
      rm -f "$out"
      return 1
    fi
    [ "$a" -eq $((max - 1)) ] && npm cache clean --force 2>/dev/null || true
    sleep $((5 * a))
    a=$((a + 1))
  done
  rm -f "$out"
  return 1
}

step "install_cli"
npm_retry "$CLI_PKG_SPEC" npm install -g --no-audit --no-fund --loglevel=warn --engine-strict "$CLI_PKG_SPEC"

step "verify_cli"
${bashSingleQuote(spec.cliBinary)} --version

step "install_gateway_sdk"
install -d -m 0755 ${bashSingleQuote(gatewayDir)}
echo ${bashSingleQuote(b64(pkgJson))} | base64 -d > ${bashSingleQuote(`${gatewayDir}/package.json`)}
npm_retry ${bashSingleQuote(`${spec.sdkPackage}@${sdkVersion}`)} npm install --prefix ${bashSingleQuote(gatewayDir)} --omit=dev --no-audit --no-fund --loglevel=warn
chmod -R a+rX ${bashSingleQuote(gatewayDir)}

step "atlas_dirs"
install -d -m 0750 -o ${user} -g ${user} ${bashSingleQuote(atlasDir)}
install -d -m 0750 -o ${user} -g ${user} ${bashSingleQuote(workspaceDir)}

step "terminal_deps"
# Best-effort: without ttyd the browser terminal does not start, but the agent,
# its API and the chat UI are unaffected.
apt-get $APT_OPTS install -y tmux ttyd || echo "WARNING: could not install ttyd/tmux — the browser terminal will be unavailable" >&2
${args.webuiEnabled ? buildOpenWebUiStandaloneInstallSteps(args.sidecarVersion) : ""}`
      return buildBootstrapFraming(
        {
          installDir: spec.installDir,
          systemUser: spec.systemUser,
          minNodeVersion: CLI_VPS_MIN_NODE,
          gatewayPort: args.gatewayPort,
          sshPort: args.sshPort,
          manageFirewall: args.manageFirewall,
        },
        `${installSteps}${args.extraInstallSteps ?? ""}`,
      )
    },

    /**
     * Runs over SSH after the `.env` is written and before the gateway starts,
     * on first provision and on every reprovision: (re)writes the gateway code
     * and terminal launcher (so gateway fixes ship on reprovision), the model
     * pins, and the engine's own config. Idempotent; a non-zero exit fails the
     * provision.
     */
    renderInitScript(args: RenderInitScriptArgs): string {
      const modelEnv = renderModelEnv({ ATLAS_MODEL: args.model, ...spec.modelEnv(args.model) })
      const launcher = `#!/bin/bash
# ${spec.displayName} browser terminal — one shared tmux session, reattached on
# every connection, with a shell left behind when the CLI exits.
cd ${bashSingleQuote(workspaceDir)} || exit 1
exec tmux new-session -A -s agent "${spec.cliBinary}; exec bash"
`
      return `#!/bin/bash
set -euo pipefail

echo "=== provision: ${spec.id}_gateway ==="
install -d -m 0755 ${bashSingleQuote(gatewayDir)}
echo ${bashSingleQuote(b64(CLI_GATEWAY_SOURCE))} | base64 -d > ${bashSingleQuote(`${gatewayDir}/${CLI_GATEWAY_FILE}`)}
echo ${bashSingleQuote(b64(launcher))} | base64 -d > ${bashSingleQuote(terminalLauncher)}
chmod 0644 ${bashSingleQuote(`${gatewayDir}/${CLI_GATEWAY_FILE}`)}
chmod 0755 ${bashSingleQuote(terminalLauncher)}
if [ ! -d ${bashSingleQuote(`${gatewayDir}/node_modules/${spec.sdkPackage}`)} ]; then
  echo "${spec.sdkPackage} is missing from ${gatewayDir} — the bootstrap did not finish" >&2
  exit 1
fi

echo "=== provision: ${spec.id}_dirs ==="
install -d -m 0750 -o ${user} -g ${user} ${bashSingleQuote(atlasDir)}
install -d -m 0750 -o ${user} -g ${user} ${bashSingleQuote(workspaceDir)}

echo "=== provision: ${spec.id}_model ==="
echo ${bashSingleQuote(b64(modelEnv))} | base64 -d > ${bashSingleQuote(modelEnvPath)}
chmod 0600 ${bashSingleQuote(modelEnvPath)}
chown ${user}:${user} ${bashSingleQuote(modelEnvPath)}

echo "=== provision: ${spec.id}_config ==="
${spec.renderEngineConfig({ model: args.model, installDir: spec.installDir, workspaceDir, systemUser: spec.systemUser })}

echo "=== provision: ${spec.id}_cli_check ==="
sudo -u ${user} env HOME=${bashSingleQuote(spec.installDir)} ${bashSingleQuote(spec.cliBinary)} --version

echo "=== provision: ${spec.id}_init_done ==="
`
    },

    sidecar,
    terminal,
  }
}

