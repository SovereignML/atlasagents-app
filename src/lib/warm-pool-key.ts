/**
 * Warm-pool keys. Pure (no DB), so the key contract is unit-testable; the pool
 * itself lives in warm-pool.ts, which re-exports these.
 */

import { getRuntime } from "@/lib/runtimes"
import { primaryAgentZone } from "@/lib/agent-zones"
import { UNIVERSAL_POOL_RUNTIME, universalBakeVersions, usesUniversalPool } from "@/lib/runtimes/universal"

/**
 * Bumped when what a universal VM installs changes without any version pin
 * moving (2: Hermes gained its `messaging` extra, so VMs baked without aiohttp,
 * whose Hermes never serves its API, are retired). OpenClaw's pool is not
 * affected.
 */
export const BAKE_REVISION = 2

/**
 * What a pooled VM is baked WITH: the runtime (and sidecar) versions its
 * bootstrap installs, and the agent zone its pre-assigned URL is created in.
 *
 * It is part of the pool key so that changing a version pin, or moving new
 * agents to another zone, retires every VM baked under the old settings: their
 * key stops matching a configured target, the stale-key reap destroys them,
 * and the deficit loop bakes replacements. Without it a pool VM baked before
 * the change would still be handed out for up to READY_MAX_AGE_MS — with the
 * old runtime version, or a URL in the old zone.
 *
 * An unpinned runtime (`*_VERSION=latest`) contributes the literal "latest",
 * so upstream releases do not churn the pool; only our own changes do.
 */
export function bakeIdentity(runtimeId: string, webuiEnabled: boolean): string {
  // A universal VM carries every chat-UI engine, so any of their pins retires it.
  if (runtimeId === UNIVERSAL_POOL_RUNTIME) {
    return `${universalBakeVersions().join("+")}+bake${BAKE_REVISION}@${primaryAgentZone().domain}`
  }
  const runtime = getRuntime(runtimeId)
  const versions = [runtime.version()]
  if (webuiEnabled && runtime.sidecar) versions.push(runtime.sidecar.version())
  return `${versions.join("+")}@${primaryAgentZone().domain}`
}

/**
 * The pool slot a deploy draws from: an engine the chat UI fronts (with its
 * chat UI on) is served by the universal pool; anything else (OpenClaw, or a
 * chat-UI engine deployed without one) by its own runtime's pool.
 */
export function poolRuntimeFor(runtime: string, webuiEnabled: boolean): string {
  return usesUniversalPool(runtime, webuiEnabled) ? UNIVERSAL_POOL_RUNTIME : runtime
}

export function poolKeyFor(t: {
  providerSlug: string
  planCode: string
  regionCode: string
  runtime: string
  webuiEnabled: boolean
}): string {
  const runtime = poolRuntimeFor(t.runtime, t.webuiEnabled)
  return `${t.providerSlug}|${t.planCode}|${t.regionCode}|${runtime}|${t.webuiEnabled ? 1 : 0}|${bakeIdentity(runtime, t.webuiEnabled)}`
}
