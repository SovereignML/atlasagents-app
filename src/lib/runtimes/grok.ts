import { createCliRuntime, pinOverride } from "./cli-runtime"
import { bashSingleQuote } from "./python-install"

/**
 * Grok as an agent runtime: xAI's coding agent (Grok Build, npm
 * `@xai-official/grok`, a native binary), which speaks ACP itself
 * (`grok agent stdio`), so the Atlas CLI gateway and the chat UI both drive it
 * that way, with the `grok` TUI in the browser terminal. See cli-runtime.ts
 * for the box layout.
 *
 * Models go through OpenRouter: each xAI model the agent may use overrides the
 * built-in catalog entry of the same name (`[model.<name>]` in
 * `~/.grok/config.toml`) with OpenRouter's endpoint and the per-instance key
 * (OPENROUTER_API_KEY), so usage is metered like every other engine and no
 * xAI login is needed. `allowed_models` limits the picker to those entries.
 */

/**
 * The Grok release new boxes install — one behind npm's `latest` at the time
 * of pinning (1.0.62), per the soak policy for every runtime pin.
 * ATLAS_GROK_VERSION overrides it (a version, or `latest`).
 */
export const GROK_PINNED_VERSION = "1.0.61"
export const GROK_VERSION = () => pinOverride(process.env.ATLAS_GROK_VERSION) ?? GROK_PINNED_VERSION

export const GROK_GATEWAY_PORT = 8655
export const GROK_INSTALL_DIR = "/opt/grok"
const GROK_BIN = "/usr/bin/grok"
const GROK_HOME = `${GROK_INSTALL_DIR}/.grok`

/** An xAI model's name inside Grok: the OpenRouter slug without `x-ai/`. */
export function grokModelName(slug: string): string {
  return slug.replace(/^x-ai\//, "")
}

/** TOML basic string. JSON string syntax is a valid subset for these inputs. */
function tomlString(s: string): string {
  return JSON.stringify(s)
}

/** `~/.grok/config.toml`: the agent's models on OpenRouter, the default, nothing phoning home. */
export function renderGrokConfig(args: { model: string; models: string[] }): string {
  const slugs = args.models.length ? args.models : [args.model]
  const main = tomlString(grokModelName(args.model))
  const entries = slugs
    .map(
      (slug) => `[model.${tomlString(grokModelName(slug))}]
model = ${tomlString(slug)}
name = ${tomlString(grokModelName(slug))}
base_url = "https://openrouter.ai/api/v1"
env_key = "OPENROUTER_API_KEY"
api_backend = "chat_completions"
`,
    )
    .join("\n")
  return `# Written by Atlas Agents on every (re)provision — edits here are overwritten.
[cli]
auto_update = false

[features]
telemetry = false

[models]
default = ${main}
allowed_models = [${slugs.map((s) => tomlString(grokModelName(s))).join(", ")}]
# Grok's helper calls (titles, web search, image descriptions, suggestions)
# default to built-in xAI names OpenRouter does not know; keep them on the agent's.
session_summary = ${main}
web_search = ${main}
image_description = ${main}
prompt_suggestion = ${main}

${entries}`
}

export const grokRuntime = createCliRuntime({
  id: "grok",
  displayName: "Grok",
  cliPackage: "@xai-official/grok",
  cliVersion: GROK_VERSION,
  cliBinary: GROK_BIN,
  gatewayPort: GROK_GATEWAY_PORT,
  installDir: GROK_INSTALL_DIR,
  systemUser: "grok",

  engineEnv() {
    return {
      ATLAS_ACP_COMMAND: `${GROK_BIN} agent stdio`,
      GROK_DISABLE_AUTOUPDATER: "1",
      GROK_TELEMETRY_ENABLED: "false",
      DISABLE_TELEMETRY: "1",
    }
  },

  modelEnv() {
    // The model lives in config.toml (and ATLAS_MODEL for /v1/models).
    return {}
  },

  renderEngineConfig({ model, models, systemUser }) {
    const user = bashSingleQuote(systemUser)
    const config = Buffer.from(renderGrokConfig({ model, models }), "utf8").toString("base64")
    const path = `${GROK_HOME}/config.toml`
    return `install -d -m 0700 -o ${user} -g ${user} ${bashSingleQuote(GROK_HOME)}
echo ${bashSingleQuote(config)} | base64 -d > ${bashSingleQuote(path)}
chmod 0600 ${bashSingleQuote(path)}
chown ${user}:${user} ${bashSingleQuote(path)}`
  },
})
