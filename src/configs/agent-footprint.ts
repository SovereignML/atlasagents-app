// How much of a server one agent occupies, and therefore how many fit.
//
// Used for the "fits ~N more agents" line on a connected BYOS server and, in
// future, for the number of install slots offered. These are advisory sizing
// figures, not enforced quotas — a customer's own hardware is theirs to
// overcommit if they want to.
//
// Pure data + arithmetic: no DB, no network.

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
 * heavier process), and Hermes + Open WebUI is far larger again because the
 * sidecar's dependency tree pulls chromadb/sentence-transformers/torch — the
 * bootstrap itself calls that out as dominating a cold install.
 */
export const AGENT_FOOTPRINTS: RuntimeFootprint[] = [
  { key: "openclaw", label: "OpenClaw", vcpu: 1, ramMb: 1024, diskGb: 3 },
  { key: "hermes", label: "Hermes", vcpu: 1, ramMb: 1536, diskGb: 5 },
  { key: "hermes-webui", label: "Hermes + Open WebUI", vcpu: 2, ramMb: 3072, diskGb: 10 },
]

/**
 * Held back for the operating system and whatever else the owner already runs.
 * BYOS boxes are not dedicated to us, so this is deliberately not stingy.
 */
export const HOST_RESERVE = { vcpu: 1, ramMb: 1024, diskGb: 5 }

/** The variant we size the headline capacity number against (the BYOS default). */
export const DEFAULT_FOOTPRINT_KEY = "openclaw"

export function footprintKey(runtime: string, webuiEnabled = false): string {
  return runtime === "hermes" && webuiEnabled ? "hermes-webui" : runtime
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
