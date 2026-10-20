import { CLI_GATEWAY_DIR } from "./cli-gateway"
import { createCliRuntime, pinOverride } from "./cli-runtime"
import { bashSingleQuote } from "./python-install"

/**
 * Pi as an agent runtime: Earendil's minimal coding agent
 * (`@earendil-works/pi-coding-agent`, formerly `@mariozechner/...`). Pi has no
 * ACP server of its own; the community adapter `pi-acp` runs `pi --mode rpc`
 * and speaks ACP, so the Atlas CLI gateway and the chat UI both drive Pi
 * through it, with the `pi` TUI in the browser terminal. Beta, because the
 * adapter is not Pi's own. See cli-runtime.ts for the box layout.
 *
 * Models go through OpenRouter (Pi's `openrouter` provider, the per-instance
 * key from OPENROUTER_API_KEY), metered like every other engine. Pi names them
 * `openrouter/<slug>` and accepts any of them; the chat UI's own list decides
 * what is offered.
 */

/**
 * The releases new boxes install — one behind npm's latest at the time of
 * pinning (Pi 1.3.0, pi-acp 0.0.34), per the soak policy for every runtime pin.
 * ATLAS_PI_VERSION / ATLAS_PI_ACP_VERSION override them (a version, or `latest`).
 */
export const PI_PINNED_VERSION = "1.2.0"
export const PI_ACP_PINNED_VERSION = "0.0.33"
export const PI_VERSION = () => pinOverride(process.env.ATLAS_PI_VERSION) ?? PI_PINNED_VERSION
export const PI_ACP_VERSION = () => pinOverride(process.env.ATLAS_PI_ACP_VERSION) ?? PI_ACP_PINNED_VERSION

export const PI_GATEWAY_PORT = 8653
export const PI_INSTALL_DIR = "/opt/pi"
const PI_BIN = "/usr/bin/pi"
const PI_AGENT_DIR = `${PI_INSTALL_DIR}/.pi/agent`

/** `~/.pi/agent/settings.json`: OpenRouter, the model, and no startup banner in replies. */
export function renderPiSettings(args: { model: string; models: string[] }): string {
  return (
    JSON.stringify(
      {
        defaultProvider: "openrouter",
        defaultModel: args.model,
        enabledModels: (args.models.length ? args.models : [args.model]).map((s) => `openrouter/${s}`),
        // pi-acp otherwise sends Pi's version banner as the first reply text.
        quietStartup: true,
      },
      null,
      2,
    ) + "\n"
  )
}

export const piRuntime = createCliRuntime({
  id: "pi",
  displayName: "Pi",
  cliPackage: "@earendil-works/pi-coding-agent",
  cliVersion: PI_VERSION,
  cliBinary: PI_BIN,
  // The gateway runs Pi through the adapter installed next to it.
  sdkPackage: "pi-acp",
  sdkVersion: PI_ACP_VERSION,
  gatewayPort: PI_GATEWAY_PORT,
  installDir: PI_INSTALL_DIR,
  systemUser: "pi",

  engineEnv({ installDir }) {
    return {
      ATLAS_ACP_COMMAND: `${installDir}/${CLI_GATEWAY_DIR}/node_modules/.bin/pi-acp`,
      // pi-acp asks npm for Pi's latest version on every session and adds an
      // "update available" line to the reply; the box moves by pin instead.
      npm_config_offline: "true",
    }
  },

  modelEnv() {
    // The model lives in settings.json (and ATLAS_MODEL for /v1/models).
    return {}
  },

  renderEngineConfig({ model, models, systemUser }) {
    const user = bashSingleQuote(systemUser)
    const settings = Buffer.from(renderPiSettings({ model, models }), "utf8").toString("base64")
    const path = `${PI_AGENT_DIR}/settings.json`
    return `install -d -m 0700 -o ${user} -g ${user} ${bashSingleQuote(`${PI_INSTALL_DIR}/.pi`)} ${bashSingleQuote(PI_AGENT_DIR)}
echo ${bashSingleQuote(settings)} | base64 -d > ${bashSingleQuote(path)}
chmod 0600 ${bashSingleQuote(path)}
chown ${user}:${user} ${bashSingleQuote(path)}`
  },
})
