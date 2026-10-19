// How much of a server one agent occupies, and therefore how many fit.
//
// Used for the "fits ~N more agents" line on a connected BYOS server and, in
// future, for the number of install slots offered. These are advisory sizing
// figures, not enforced quotas — a customer's own hardware is theirs to
// overcommit if they want to.
//
// Pure data + arithmetic: no DB, no network.

import { runtimeCaps } from "@/lib/runtimes/labels"

export type RuntimeFootprint = {
  /** Catalog key: runtime id, plus "-webui" when the sidecar is included. */
  key: string
  label: string
  vcpu: number
  ramMb: number
  diskGb: number
}

/**
 * Per-variant footprints. Hermes needs more than OpenClaw (a Python venv and a
 * heavier process); the "-lite" variants add the chat UI (AgentWebUI Lite).
 */
export const AGENT_FOOTPRINTS: RuntimeFootprint[] = [
  { key: "openclaw", label: "OpenClaw", vcpu: 1, ramMb: 1024, diskGb: 3 },
  { key: "hermes", label: "Hermes", vcpu: 1, ramMb: 1536, diskGb: 5 },
  // The chat page itself is ~40MB, so the engine dominates: Codex's process is
  // the largest (~580MB, Claude Code ~370MB), and the coding agents run builds
  // and tests in the workspace, hence the extra disk.
  { key: "hermes-lite", label: "Hermes + AgentWebUI Lite", vcpu: 1, ramMb: 1792, diskGb: 6 },
  { key: "claude-code-lite", label: "Claude Code + AgentWebUI Lite", vcpu: 1, ramMb: 1792, diskGb: 8 },
  { key: "codex-lite", label: "Codex + AgentWebUI Lite", vcpu: 1, ramMb: 2048, diskGb: 8 },
]

/**
 * Held back for the operating system and whatever else the owner already runs.
 * BYOS boxes are not dedicated to us, so this is deliberately not stingy.
 */
export const HOST_RESERVE = { vcpu: 1, ramMb: 1024, diskGb: 5 }

/** The variant we size the headline capacity number against (the BYOS default). */
export const DEFAULT_FOOTPRINT_KEY = "openclaw"

export function footprintKey(runtime: string, webuiEnabled = false): string {
  return runtimeCaps(runtime).hasSidecar && webuiEnabled ? `${runtime}-lite` : runtime
}

export function getFootprint(key: string): RuntimeFootprint | undefined {
  return AGENT_FOOTPRINTS.find((f) => f.key === key)
}

export type HostResources = {
  cpuCores: number | null
  ramTotalMb: number | null
  diskTotalGb: number | null
}

/**
 * How many agents of `key` this host could hold, counting from its TOTAL
 * resources minus the host reserve.
 *
 * Total rather than currently-free on purpose: free memory on a live server
 * swings with page cache and whatever is running this minute, which would make
 * the number jitter between page loads. Returns 0 when the box is too small or
 * when we haven't probed it yet — never a negative or a guess.
 */
export function estimateAgentCapacity(
  host: HostResources,
  key: string = DEFAULT_FOOTPRINT_KEY,
): number {
  const fp = getFootprint(key)
  if (!fp) return 0
  if (host.cpuCores == null || host.ramTotalMb == null || host.diskTotalGb == null) return 0

  const byCpu = Math.floor((host.cpuCores - HOST_RESERVE.vcpu) / fp.vcpu)
  const byRam = Math.floor((host.ramTotalMb - HOST_RESERVE.ramMb) / fp.ramMb)
  const byDisk = Math.floor((host.diskTotalGb - HOST_RESERVE.diskGb) / fp.diskGb)

  return Math.max(0, Math.min(byCpu, byRam, byDisk))
}

/** Capacity for every variant — drives "this box fits X of these, Y of those". */
export function capacityByRuntime(host: HostResources): Record<string, number> {
  return Object.fromEntries(
    AGENT_FOOTPRINTS.map((f) => [f.key, estimateAgentCapacity(host, f.key)]),
  )
}
