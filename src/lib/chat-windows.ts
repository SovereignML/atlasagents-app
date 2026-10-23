// The dashboard's chat windows: which agents' chats are open, which one is
// showing, and how large. Pure, so the window rules are unit-tested; the
// provider in components/agent-chat keeps this in React state.

import { buildPublicGatewayUrl } from "@/lib/instance-gateway-access"
import { runtimeCaps } from "@/lib/runtimes/labels"

/** What the chat window needs to know about an agent. */
export type ChatAgent = {
  id: string
  name: string
  runtime: string | null
  /** The agent's own address (https://<hostname>), when it has one. */
  publicUrl: string | null
  /** http://<ip>, the fallback address. */
  ipUrl: string | null
}

/** `panel` docks to the right edge; `full` fills the screen. */
export type ChatSize = "panel" | "full"

export type ChatWindow = { agent: ChatAgent; openedAt: number }

export type ChatWindows = {
  /** Open chats, oldest first. Each keeps its frame loaded while minimized. */
  windows: ChatWindow[]
  /** The chat on screen; every other open chat is minimized to the dock. */
  activeId: string | null
  size: ChatSize
}

/** Each open chat is a whole chat app in a frame, so keep only a few. */
export const MAX_CHAT_WINDOWS = 4

export const EMPTY_CHAT_WINDOWS: ChatWindows = { windows: [], activeId: null, size: "full" }

/**
 * Open (or bring back) an agent's chat and show it. Any other open chat is
 * minimized. Past the cap, the least recently opened minimized chat closes.
 */
export function openChatWindow(
  state: ChatWindows,
  agent: ChatAgent,
  now: number,
  size?: ChatSize,
): ChatWindows {
  const existing = state.windows.find((w) => w.agent.id === agent.id)
  let windows = existing
    ? state.windows.map((w) => (w.agent.id === agent.id ? { agent, openedAt: now } : w))
    : [...state.windows, { agent, openedAt: now }]
  while (windows.length > MAX_CHAT_WINDOWS) {
    const oldest = windows
      .filter((w) => w.agent.id !== agent.id)
      .reduce((a, b) => (b.openedAt < a.openedAt ? b : a))
    windows = windows.filter((w) => w !== oldest)
  }
  return { windows, activeId: agent.id, size: size ?? state.size }
}

/** Send the showing chat to the dock. Its frame stays loaded. */
export function minimizeChatWindow(state: ChatWindows): ChatWindows {
  return { ...state, activeId: null }
}

/** Close an agent's chat and unload it. */
export function closeChatWindow(state: ChatWindows, agentId: string): ChatWindows {
  return {
    ...state,
    windows: state.windows.filter((w) => w.agent.id !== agentId),
    activeId: state.activeId === agentId ? null : state.activeId,
  }
}

export function resizeChatWindow(state: ChatWindows, size: ChatSize): ChatWindows {
  return { ...state, size }
}

/**
 * Read back what a tab saved, dropping anything malformed. Chats come back
 * minimized: each one signs in again only when it is shown.
 */
export function restoreChatWindows(saved: unknown): ChatWindows {
  if (!saved || typeof saved !== "object") return EMPTY_CHAT_WINDOWS
  const s = saved as Partial<ChatWindows>
  const windows = (Array.isArray(s.windows) ? s.windows : [])
    .filter(
      (w): w is ChatWindow =>
        !!w &&
        typeof w === "object" &&
        typeof w.agent?.id === "string" &&
        typeof w.agent?.name === "string" &&
        typeof w.openedAt === "number",
    )
    .slice(-MAX_CHAT_WINDOWS)
  return { windows, activeId: null, size: s.size === "panel" ? "panel" : "full" }
}

/** The hostname part of an address, for labels ("a1b2.atlasdeploy.xyz"). */
export function addressLabel(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Whether an agent's chat can open in the dashboard: an AgentWebUI Lite chat page. */
export function hasDashboardChat(i: {
  runtime: string | null
  webuiEnabled: boolean | null
  chatUi: string | null
}): boolean {
  // CHAT_UI_LITE, spelled out: agentwebui-lite.ts imports node:crypto, and
  // this module runs in the browser.
  return runtimeCaps(i.runtime).hasSidecar && Boolean(i.webuiEnabled) && i.chatUi === "agentwebui-lite"
}

/** The chat window's view of an agent row. */
export function chatAgentFor(i: {
  id: string
  name: string
  runtime: string | null
  domain: string | null
  managedSubdomain: string | null
  tlsStatus: string | null
  ipAddress: string | null
}): ChatAgent {
  const access = buildPublicGatewayUrl(i)
  const ip = i.ipAddress?.trim()
  return {
    id: i.id,
    name: i.name,
    runtime: i.runtime,
    // A raw-IP agent has no address of its own beyond the IP.
    publicUrl: i.domain || i.managedSubdomain ? (access?.url ?? null) : null,
    ipUrl: ip ? `http://${ip}` : null,
  }
}
