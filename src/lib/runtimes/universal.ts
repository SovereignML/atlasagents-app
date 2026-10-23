/**
 * The universal warm-pool image: one pooled VM with every engine the chat UI
 * fronts installed in advance (Hermes, Claude Code, Codex, OpenCode, Pi,
 * Gemini CLI, Grok — every engine but OpenClaw, which keeps its own pool) plus
 * AgentWebUI Lite and every engine's ACP side. A deploy of any of them claims
 * the same VM, and only the chosen engine is then configured and started: its
 * env, config and units are written at claim (Phase A / B), exactly as on a
 * single-engine pool VM. The other engines stay installed, with no units, no
 * env and no keys.
 *
 * One pool for seven engines means fewer idle VMs than one pool each, and no
 * engine waits on a cold install because its own pool happened to be empty.
 *
 * Pure (no DB): the warm pool and the pool key import it, and the tests do too.
 */

import { getRuntime, type RuntimeId } from "@/lib/runtimes"
import { buildPrereqScript } from "./bootstrap"
import type { RuntimeEngine } from "./types"

/** The pool target / WarmVm.runtime of a universal VM. Not an engine id. */
export const UNIVERSAL_POOL_RUNTIME = "universal"

/** Every engine a universal VM carries, in install order (Hermes sets up Python first). */
export const LITE_ENGINES = [
  "hermes",
  "claude-code",
  "codex",
  "opencode",
  "pi",
  "gemini-cli",
  "grok",
] as const satisfies readonly RuntimeId[]

/** Whether a deploy of this engine (with its chat UI) is served by the universal pool. */
export function usesUniversalPool(runtimeId: string, webuiEnabled: boolean): boolean {
  return webuiEnabled && (LITE_ENGINES as readonly string[]).includes(runtimeId)
}

function liteEngines(): RuntimeEngine[] {
  return LITE_ENGINES.map((id) => getRuntime(id))
}

/** The highest Node floor across the engines, so one Node serves all of them. */
function highestMinNode(versions: string[]): string {
  const parts = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0)
  return versions.reduce((best, v) => {
    const [a, b] = [parts(best), parts(v)]
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] ?? 0) !== (b[i] ?? 0)) return (b[i] ?? 0) > (a[i] ?? 0) ? v : best
    }
    return best
  })
}

/** Options for a universal bootstrap that is not a pooled VM: the BYOS connect-time prebake. */
export type UniversalBootstrapOpts = {
  /** The customer's sshd port, for the firewall allow-rule. */
  sshPort?: number
  /** False on BYOS: allow-rules only, never `ufw enable`. */
  manageFirewall?: boolean
  /** Bake Chrome and agent-browser. Default true, as on every pool VM. */
  browserDeps?: boolean
  /** False leaves Caddy out (a BYOS server that already runs a web server). */
  installCaddy?: boolean
  /** Per-engine version pins; an engine without one installs its code pin. */
  versions?: Partial<Record<(typeof LITE_ENGINES)[number], string>>
  /** Steps run after every engine's install, inside the framing. */
  extraSteps?: string
}

/**
 * The bootstrap of a universal VM: the shared framing once (with every
 * engine's system account), then each engine's own install steps with its chat
 * UI, at each engine's pinned version. On a pool VM browser tools are baked in
 * (bake time is ours, and a claim cannot add them quickly); the BYOS prebake
 * passes its own options.
 */
export function renderUniversalBootstrap(opts: UniversalBootstrapOpts = {}): string {
  const engines = liteEngines()
  const payload = engines
    .map((e) => {
      if (!e.renderInstallSteps) throw new Error(`${e.id} has no install steps to share`)
      return `
echo "=== universal: ${e.id} ==="
${e.renderInstallSteps({
  gatewayPort: e.gatewayPort,
  webuiEnabled: true,
  browserDeps: opts.browserDeps !== false,
  runtimeVersion: opts.versions?.[e.id as (typeof LITE_ENGINES)[number]],
})}`
    })
    .join("\n")
  const [primary, ...rest] = engines.map((e) => ({ installDir: e.paths.installDir, systemUser: e.paths.systemUser }))
  return buildPrereqScript({
    accounts: [primary, ...rest],
    minNodeVersion: universalMinNode(),
    sshPort: opts.sshPort,
    manageFirewall: opts.manageFirewall,
    installCaddy: opts.installCaddy,
    payloadSteps: payload + (opts.extraSteps ?? ""),
  })
}

/** The Node a universal box gets: the highest floor across its engines. */
export function universalMinNode(): string {
  return highestMinNode(liteEngines().map((e) => e.minNode))
}

/** What a universal VM is baked with: every engine's version and Lite's (for the pool key). */
export function universalBakeVersions(): string[] {
  const engines = liteEngines()
  return [...engines.map((e) => `${e.id}@${e.version()}`), `lite@${engines[0].sidecar!.version()}`]
}
