import { createCliRuntime, pinOverride } from "./cli-runtime"
import { bashSingleQuote } from "./python-install"

/**
 * Gemini CLI as an agent runtime: Google's open-source coding agent, whose own
 * CLI speaks ACP (`gemini --acp`), so the Atlas CLI gateway and the chat UI
 * both drive it that way, with the `gemini` TUI in the browser terminal. See
 * cli-runtime.ts for the box layout.
 *
 * Gemini CLI speaks only Gemini's own API, which OpenRouter does not serve. So
 * GOOGLE_GEMINI_BASE_URL points at the Atlas gateway on loopback, which
 * translates each call to an OpenRouter chat completion on the per-instance
 * key (cli-gateway.ts, handleGemini): metered like every other engine, and
 * Google models only (`google/<name>`, named `<name>` inside the CLI). The CLI
 * authenticates to the gateway with the gateway token as its "Gemini API key".
 */

/**
 * The Gemini CLI release new boxes install — one behind npm's latest at the
 * time of pinning (0.64.0), per the soak policy for every runtime pin.
 * ATLAS_GEMINI_CLI_VERSION overrides it (a version, or `latest`).
 */
export const GEMINI_CLI_PINNED_VERSION = "0.63.0"
export const GEMINI_CLI_VERSION = () =>
  pinOverride(process.env.ATLAS_GEMINI_CLI_VERSION) ?? GEMINI_CLI_PINNED_VERSION

export const GEMINI_CLI_GATEWAY_PORT = 8654
export const GEMINI_CLI_INSTALL_DIR = "/opt/gemini-cli"
const GEMINI_BIN = "/usr/bin/gemini"
const GEMINI_SETTINGS_DIR = `${GEMINI_CLI_INSTALL_DIR}/.gemini`
/** The agent's models, one OpenRouter slug per line, for the gateway's Gemini API translation. */
export const GEMINI_MODELS_PATH = `${GEMINI_CLI_INSTALL_DIR}/.atlas/gemini-models`

/** A Google model's name inside Gemini CLI: the OpenRouter slug without `google/`. */
export function geminiModelName(slug: string): string {
  return slug.replace(/^google\//, "")
}

/** `~/.gemini/settings.json`: the gateway as a Gemini API key, the model, nothing phoning home. */
export function renderGeminiSettings(args: { model: string }): string {
  return (
    JSON.stringify(
      {
        security: {
          auth: { selectedType: "gemini-api-key" },
          // A managed box: the workspace is the agent's own.
          folderTrust: { enabled: false },
        },
        model: { name: geminiModelName(args.model) },
        // The persona files the provisioner writes for every engine.
        context: { fileName: ["AGENTS.md", "IDENTITY.md", "GEMINI.md"] },
        // Versions move by pin, and nothing is shared out.
        general: { enableAutoUpdate: false, enableAutoUpdateNotification: false },
        privacy: { usageStatisticsEnabled: false },
        telemetry: { enabled: false },
        ide: { enabled: false },
      },
      null,
      2,
    ) + "\n"
  )
}

export const geminiCliRuntime = createCliRuntime({
  id: "gemini-cli",
  displayName: "Gemini CLI",
  cliPackage: "@google/gemini-cli",
  cliVersion: GEMINI_CLI_VERSION,
  cliBinary: GEMINI_BIN,
  gatewayPort: GEMINI_CLI_GATEWAY_PORT,
  installDir: GEMINI_CLI_INSTALL_DIR,
  systemUser: "gemini-cli",

  engineEnv({ gatewayToken }) {
    return {
      ATLAS_ACP_COMMAND: `${GEMINI_BIN} --acp`,
      GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${GEMINI_CLI_GATEWAY_PORT}`,
      GEMINI_API_KEY: gatewayToken,
      ATLAS_GEMINI_MODELS_PATH: GEMINI_MODELS_PATH,
      GEMINI_CLI_TRUST_WORKSPACE: "true",
    }
  },

  modelEnv(model) {
    // settings.json holds the model too; GEMINI_MODEL wins over it, so a
    // model change reaches the terminal even before settings are re-read.
    return { GEMINI_MODEL: geminiModelName(model) }
  },

  renderEngineConfig({ model, models, systemUser }) {
    const user = bashSingleQuote(systemUser)
    const settings = Buffer.from(renderGeminiSettings({ model }), "utf8").toString("base64")
    const list = Buffer.from((models.length ? models : [model]).join("\n") + "\n", "utf8").toString("base64")
    const path = `${GEMINI_SETTINGS_DIR}/settings.json`
    return `install -d -m 0700 -o ${user} -g ${user} ${bashSingleQuote(GEMINI_SETTINGS_DIR)}
echo ${bashSingleQuote(settings)} | base64 -d > ${bashSingleQuote(path)}
chmod 0600 ${bashSingleQuote(path)}
chown ${user}:${user} ${bashSingleQuote(path)}
echo ${bashSingleQuote(list)} | base64 -d > ${bashSingleQuote(GEMINI_MODELS_PATH)}
chmod 0600 ${bashSingleQuote(GEMINI_MODELS_PATH)}
chown ${user}:${user} ${bashSingleQuote(GEMINI_MODELS_PATH)}`
  },
})
