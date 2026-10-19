/**
 * Warm-pool keys. Pure (no DB), so the key contract is unit-testable; the pool
 * itself lives in warm-pool.ts, which re-exports these.
 */

import { getRuntime } from "@/lib/runtimes"
import { platformChatUi, withChatUi, type ChatUi } from "@/lib/runtimes/agentwebui-lite"
import { primaryAgentZone } from "@/lib/agent-zones"

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
export function bakeIdentity(
  runtimeId: string,
  webuiEnabled: boolean,
  // The chat UI a pooled VM bakes is the platform's (CHAT_UI). Its version is in
  // the key, so switching UIs retires the old pool, and an agent only ever
  // claims a VM with its own UI.
  chatUi: ChatUi = platformChatUi(),
): string {
  const runtime = withChatUi(getRuntime(runtimeId), chatUi)
  const versions = [runtime.version()]
  if (webuiEnabled && runtime.sidecar) versions.push(runtime.sidecar.version())
  return `${versions.join("+")}@${primaryAgentZone().domain}`
}

export function poolKeyFor(t: {
  providerSlug: string
  planCode: string
  regionCode: string
  runtime: string
  webuiEnabled: boolean
  chatUi?: ChatUi
}): string {
  return `${t.providerSlug}|${t.planCode}|${t.regionCode}|${t.runtime}|${t.webuiEnabled ? 1 : 0}|${bakeIdentity(t.runtime, t.webuiEnabled, t.chatUi)}`
}
