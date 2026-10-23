// Readiness of an agent's chat page for the in-dashboard chat. The page must
// answer /embed (it has EMBED_SECRET) and let the dashboard's origin frame it
// (FRAME_ANCESTORS). Boxes set up before in-dashboard chat have neither until
// their Lite env is rewritten, which is done here the first time someone
// opens the chat, so no migration has to run first.

import type { InferSelectModel } from "drizzle-orm"
import type { instances } from "@/db"
import { refreshChatUi } from "@/lib/provisioner"
import { liteAllowsFraming } from "@/lib/runtimes/agentwebui-lite"

type Instance = InferSelectModel<typeof instances>

type Probe = "ready" | "needs-update" | "down"

/** Agents whose page was ready recently: skip the probe for a while. */
const ready = new Map<string, number>()
const READY_TTL_MS = 10 * 60_000
/** One refresh per agent at a time, however many tabs open the chat. */
const refreshing = new Map<string, Promise<boolean>>()

async function probe(publicUrl: string, dashboardOrigin: string): Promise<Probe> {
  try {
    // No token: a page with EMBED_SECRET refuses it (401), one without says
    // it has none (404). Lite puts its frame policy on every response.
    const r = await fetch(`${publicUrl.replace(/\/+$/, "")}/embed`, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    })
    if (r.status >= 500) return "down"
    if (r.status === 401 && liteAllowsFraming(r.headers.get("content-security-policy"), dashboardOrigin)) {
      return "ready"
    }
    return "needs-update"
  } catch {
    return "down"
  }
}

export type ChatEmbedReadiness =
  | { ok: true; updated: boolean }
  | { ok: false; code: "CHAT_DOWN" | "CHAT_UPDATE_FAILED"; error: string }

/**
 * Make sure the agent's chat page can be shown inside the dashboard at
 * `dashboardOrigin`, updating its Lite env (and Lite itself, if the box is on
 * an older release) when it can't yet. The caller has checked that the origin
 * is one the agent's team may frame from.
 */
export async function ensureChatEmbeddable(
  instance: Instance,
  publicUrl: string,
  dashboardOrigin: string,
): Promise<ChatEmbedReadiness> {
  const key = `${instance.id} ${dashboardOrigin}`
  if ((ready.get(key) ?? 0) > Date.now()) return { ok: true, updated: false }

  const first = await probe(publicUrl, dashboardOrigin)
  if (first === "ready") {
    ready.set(key, Date.now() + READY_TTL_MS)
    return { ok: true, updated: false }
  }
  if (first === "down") {
    return {
      ok: false,
      code: "CHAT_DOWN",
      error: "The agent's chat page isn't answering. It may still be starting; try again in a minute.",
    }
  }

  let pending = refreshing.get(instance.id)
  if (!pending) {
    pending = refreshChatUi(instance).finally(() => refreshing.delete(instance.id))
    refreshing.set(instance.id, pending)
  }
  if (!(await pending)) {
    return {
      ok: false,
      code: "CHAT_UPDATE_FAILED",
      error: "Couldn't set up this agent's chat for the dashboard. Open it in a new tab instead, or try again.",
    }
  }
  // Lite restarts in about a second; wait for it to answer with the new env.
  for (let i = 0; i < 20; i++) {
    if ((await probe(publicUrl, dashboardOrigin)) === "ready") {
      ready.set(key, Date.now() + READY_TTL_MS)
      return { ok: true, updated: true }
    }
    await new Promise((r) => setTimeout(r, 1_000))
  }
  return {
    ok: false,
    code: "CHAT_UPDATE_FAILED",
    error: "The agent's chat was updated but hasn't come back yet. Try again in a moment.",
  }
}
