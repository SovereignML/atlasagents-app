import { createCliRuntime, pinOverride } from "./cli-runtime"
import { bashSingleQuote } from "./python-install"

/**
 * OpenCode as an agent runtime: sst's open-source coding agent, whose own CLI
 * speaks ACP (`opencode acp`), so the Atlas CLI gateway and the chat UI both
 * drive it that way, with the `opencode` TUI in the browser terminal. See
 * cli-runtime.ts for the box layout.
 *
 * Models go through OpenRouter (OpenCode's built-in `openrouter` provider, the
 * per-instance key from OPENROUTER_API_KEY), metered like every other engine.
 * OpenCode names them `openrouter/<slug>`; the provider's `whitelist` is the
 * chat UI's models, so its picker lists exactly those.
 */

/**
 * The OpenCode release new boxes install — one behind npm's latest at the time
 * of pinning (1.19.3), per the soak policy for every runtime pin.
 * ATLAS_OPENCODE_VERSION overrides it (a version, or `latest`).
 */
export const OPENCODE_PINNED_VERSION = "1.19.2"
export const OPENCODE_VERSION = () =>
  pinOverride(process.env.ATLAS_OPENCODE_VERSION) ?? OPENCODE_PINNED_VERSION

export const OPENCODE_GATEWAY_PORT = 8652
export const OPENCODE_INSTALL_DIR = "/opt/opencode"
const OPENCODE_BIN = "/usr/bin/opencode"
const OPENCODE_CONFIG_DIR = `${OPENCODE_INSTALL_DIR}/.config/opencode`

/** `~/.config/opencode/opencode.json`: OpenRouter only, the model, and the offered models. */
export function renderOpencodeConfig(args: { model: string; models: string[] }): string {
  const whitelist = args.models.length ? args.models : [args.model]
  return (
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        model: `openrouter/${args.model}`,
        enabled_providers: ["openrouter"],
        provider: {
          openrouter: {
            options: { apiKey: "{env:OPENROUTER_API_KEY}" },
            whitelist,
          },
        },
        // A managed box: versions move by pin, and nothing is shared out.
        autoupdate: false,
        share: "disabled",
      },
      null,
      2,
    ) + "\n"
  )
}

export const opencodeRuntime = createCliRuntime({
  id: "opencode",
  displayName: "OpenCode",
  cliPackage: "opencode-ai",
  cliVersion: OPENCODE_VERSION,
  cliBinary: OPENCODE_BIN,
  gatewayPort: OPENCODE_GATEWAY_PORT,
  installDir: OPENCODE_INSTALL_DIR,
  systemUser: "opencode",

  engineEnv() {
    return {
      ATLAS_ACP_COMMAND: `${OPENCODE_BIN} acp`,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    }
  },

  modelEnv() {
    // The model lives in opencode.json (and ATLAS_MODEL for /v1/models).
    return {}
  },

  renderEngineConfig({ model, models, systemUser }) {
    const user = bashSingleQuote(systemUser)
    const config = Buffer.from(renderOpencodeConfig({ model, models }), "utf8").toString("base64")
    const path = `${OPENCODE_CONFIG_DIR}/opencode.json`
    return `install -d -m 0700 -o ${user} -g ${user} ${bashSingleQuote(`${OPENCODE_INSTALL_DIR}/.config`)} ${bashSingleQuote(OPENCODE_CONFIG_DIR)}
echo ${bashSingleQuote(config)} | base64 -d > ${bashSingleQuote(path)}
chmod 0600 ${bashSingleQuote(path)}
chown ${user}:${user} ${bashSingleQuote(path)}`
  },
})
