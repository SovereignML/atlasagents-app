import { createCliRuntime, pinOverride } from "./cli-runtime"
import { bashSingleQuote } from "./open-webui"

/**
 * Codex as an agent runtime: OpenAI's coding agent, driven through
 * `@openai/codex-sdk` by the Atlas CLI gateway, with the `codex` TUI in the
 * browser terminal. See cli-runtime.ts for the box layout.
 *
 * Models go through OpenRouter as a custom model provider in
 * `$CODEX_HOME/config.toml`, authenticated with the per-instance OpenRouter key
 * (OPENROUTER_API_KEY), so usage is metered like every other engine.
 */

/**
 * The Codex CLI / SDK releases new boxes install — one behind npm's latest at
 * the time of pinning (0.162.1), matching the soak policy for every other
 * runtime pin. The SDK depends on the CLI at the same version; bump them
 * together, after a test deploy. Env overrides: CODEX_VERSION,
 * CODEX_SDK_VERSION (a version, or `latest`).
 */
export const CODEX_PINNED_VERSION = "0.162.0"
export const CODEX_SDK_PINNED_VERSION = "0.162.0"
export const CODEX_VERSION = () => pinOverride(process.env.CODEX_VERSION) ?? CODEX_PINNED_VERSION
export const CODEX_SDK_VERSION = () => pinOverride(process.env.CODEX_SDK_VERSION) ?? CODEX_SDK_PINNED_VERSION

export const CODEX_GATEWAY_PORT = 8651
export const CODEX_INSTALL_DIR = "/opt/codex"
export const CODEX_HOME = `${CODEX_INSTALL_DIR}/.codex`
const CODEX_BIN = "/usr/bin/codex"

/**
 * Which OpenAI wire protocol Codex speaks to OpenRouter. Codex prefers the
 * Responses API; `chat` (Chat Completions) is the fallback if OpenRouter's
 * Responses endpoint misbehaves for tool calls. Switchable with CODEX_WIRE_API
 * and a reprovision — no code deploy needed.
 */
export function codexWireApi(): "responses" | "chat" {
  return process.env.CODEX_WIRE_API?.trim() === "chat" ? "chat" : "responses"
}

/** TOML basic string. JSON string syntax is a valid subset for these inputs. */
function tomlString(s: string): string {
  return JSON.stringify(s)
}

export function renderCodexConfigToml(args: { model: string; workspaceDir: string }): string {
  return `# Written by Atlas Agents on every (re)provision — edits here are overwritten.
model = ${tomlString(args.model)}
model_provider = "openrouter"
# The agent runs as an unprivileged system user on its own box; that user is
# the fence. Nobody is attached to answer approval prompts.
approval_policy = "never"
sandbox_mode = "danger-full-access"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
env_key = "OPENROUTER_API_KEY"
wire_api = ${tomlString(codexWireApi())}

[projects.${tomlString(args.workspaceDir)}]
trust_level = "trusted"
`
}

export const codexRuntime = createCliRuntime({
  id: "codex",
  displayName: "Codex",
  cliPackage: "@openai/codex",
  cliVersion: CODEX_VERSION,
  cliBinary: CODEX_BIN,
  sdkPackage: "@openai/codex-sdk",
  sdkVersion: CODEX_SDK_VERSION,
  gatewayPort: CODEX_GATEWAY_PORT,
  installDir: CODEX_INSTALL_DIR,
  systemUser: "codex",

  engineEnv() {
    return {
      CODEX_HOME,
      // The gateway's SDK runs the same globally installed binary the terminal
      // does, so the API and the TUI never drift apart.
      ATLAS_CODEX_BIN: CODEX_BIN,
    }
  },

  modelEnv() {
    // The model lives in config.toml (and ATLAS_MODEL for /v1/models).
    return {}
  },

  renderEngineConfig({ model, workspaceDir, systemUser }) {
    const user = bashSingleQuote(systemUser)
    const toml = Buffer.from(renderCodexConfigToml({ model, workspaceDir }), "utf8").toString("base64")
    return `install -d -m 0700 -o ${user} -g ${user} ${bashSingleQuote(CODEX_HOME)}
echo ${bashSingleQuote(toml)} | base64 -d > ${bashSingleQuote(`${CODEX_HOME}/config.toml`)}
chmod 0600 ${bashSingleQuote(`${CODEX_HOME}/config.toml`)}
chown ${user}:${user} ${bashSingleQuote(`${CODEX_HOME}/config.toml`)}`
  },
})
