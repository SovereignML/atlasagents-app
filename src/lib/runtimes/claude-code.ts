import { CLAUDE_CODE_MODELS } from "@/lib/model-router"
import { createCliRuntime, pinOverride } from "./cli-runtime"
import { bashSingleQuote } from "./python-install"

/**
 * Claude Code as an agent runtime: Anthropic's coding agent, driven through
 * `@anthropic-ai/claude-agent-sdk` by the Atlas CLI gateway, with the `claude`
 * TUI in the browser terminal. See cli-runtime.ts for the box layout.
 *
 * Models go through OpenRouter's Anthropic-compatible endpoint
 * (ANTHROPIC_BASE_URL=https://openrouter.ai/api, the per-instance OpenRouter
 * key as ANTHROPIC_AUTH_TOKEN), so usage is metered on the same key as every
 * other engine. ANTHROPIC_API_KEY is set empty on purpose: when present it
 * takes precedence and the CLI asks to approve it.
 */

/**
 * The Claude Code / Agent SDK releases new boxes install — one behind npm's
 * latest at the time of pinning (2.1.296 / 0.3.296), matching the soak policy
 * for every other runtime pin. The SDK and CLI share a release train; bump them
 * together, after a test deploy.
 *
 * Env overrides are ATLAS_CLAUDE_CODE_VERSION / ATLAS_CLAUDE_AGENT_SDK_VERSION
 * (a version, or `latest`) — NOT `CLAUDE_CODE_VERSION`, which Claude Code itself
 * exports to every process it spawns (as e.g. "2.1.296 (Claude Code)"), so any
 * tooling run from a Claude Code session would silently re-pin the fleet.
 */
export const CLAUDE_CODE_PINNED_VERSION = "2.1.295"
export const CLAUDE_AGENT_SDK_PINNED_VERSION = "0.3.295"
export const CLAUDE_CODE_VERSION = () =>
  pinOverride(process.env.ATLAS_CLAUDE_CODE_VERSION) ?? CLAUDE_CODE_PINNED_VERSION
export const CLAUDE_AGENT_SDK_VERSION = () =>
  pinOverride(process.env.ATLAS_CLAUDE_AGENT_SDK_VERSION) ?? CLAUDE_AGENT_SDK_PINNED_VERSION

export const CLAUDE_CODE_GATEWAY_PORT = 8650
export const CLAUDE_CODE_INSTALL_DIR = "/opt/claude-code"

/** OpenRouter's Anthropic-compatible base (no `/v1` — the SDK appends it). */
export const OPENROUTER_ANTHROPIC_BASE_URL = "https://openrouter.ai/api"

/**
 * Workspace CLAUDE.md: Claude Code reads CLAUDE.md, not AGENTS.md, so import
 * the persona (and identity) files the provisioner already writes for every
 * engine instead of duplicating them.
 */
export const CLAUDE_WORKSPACE_MEMORY = `@AGENTS.md
@IDENTITY.md
`

export const claudeCodeRuntime = createCliRuntime({
  id: "claude-code",
  displayName: "Claude Code",
  cliPackage: "@anthropic-ai/claude-code",
  cliVersion: CLAUDE_CODE_VERSION,
  cliBinary: "/usr/bin/claude",
  sdkPackage: "@anthropic-ai/claude-agent-sdk",
  sdkVersion: CLAUDE_AGENT_SDK_VERSION,
  gatewayPort: CLAUDE_CODE_GATEWAY_PORT,
  installDir: CLAUDE_CODE_INSTALL_DIR,
  systemUser: "claude-code",

  engineEnv({ openRouterApiKey }) {
    return {
      ANTHROPIC_BASE_URL: OPENROUTER_ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: openRouterApiKey,
      ANTHROPIC_API_KEY: "",
      // The aliases Claude Code resolves for its own background and subagent
      // calls ("haiku", "sonnet", "opus") — point them at OpenRouter slugs that
      // are on the account allowlist, or those calls fail.
      ANTHROPIC_DEFAULT_HAIKU_MODEL: CLAUDE_CODE_MODELS.low,
      ANTHROPIC_DEFAULT_SONNET_MODEL: CLAUDE_CODE_MODELS.mid,
      ANTHROPIC_DEFAULT_OPUS_MODEL: CLAUDE_CODE_MODELS.high,
      // A managed box: versions move by pin, not by self-update, and nothing
      // phones home beyond the model calls.
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    }
  },

  modelEnv(model) {
    return { ANTHROPIC_MODEL: model }
  },

  renderEngineConfig({ installDir, workspaceDir, systemUser }) {
    const user = bashSingleQuote(systemUser)
    const memory = Buffer.from(CLAUDE_WORKSPACE_MEMORY, "utf8").toString("base64")
    // Mark onboarding done and the workspace trusted in ~/.claude.json so the
    // terminal opens straight into a session instead of a theme picker and a
    // trust prompt. Merged, not overwritten: Claude Code keeps state there.
    const mergeState = [
      'const fs = require("fs")',
      'const p = process.env.HOME + "/.claude.json"',
      "let j = {}",
      "try { j = JSON.parse(fs.readFileSync(p, \"utf8\")) } catch {}",
      "j.hasCompletedOnboarding = true",
      "j.projects = j.projects || {}",
      "const w = process.env.ATLAS_WORKSPACE",
      "j.projects[w] = Object.assign({}, j.projects[w], { hasTrustDialogAccepted: true })",
      "fs.writeFileSync(p, JSON.stringify(j, null, 2), { mode: 0o600 })",
    ].join("; ")
    return `echo ${bashSingleQuote(memory)} | base64 -d > ${bashSingleQuote(`${workspaceDir}/CLAUDE.md`)}
chown ${user}:${user} ${bashSingleQuote(`${workspaceDir}/CLAUDE.md`)}
sudo -u ${user} env HOME=${bashSingleQuote(installDir)} ATLAS_WORKSPACE=${bashSingleQuote(workspaceDir)} node -e ${bashSingleQuote(mergeState)}`
  },
})
