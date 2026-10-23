"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  ExternalLink,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Minus,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { RuntimeLogo } from "@/components/dashboard/runtime-logo"
import { cn } from "@/lib/utils"
import {
  EMPTY_CHAT_WINDOWS,
  addressLabel,
  closeChatWindow,
  minimizeChatWindow,
  openChatWindow,
  resizeChatWindow,
  restoreChatWindows,
  type ChatAgent,
  type ChatSize,
  type ChatWindows,
} from "@/lib/chat-windows"

/*
 * The agent chat inside the dashboard. Each agent's chat page (AgentWebUI
 * Lite) opens in a window that fills the screen or docks to the right, and
 * minimizes to a dock at the bottom of the screen. The provider sits in the
 * dashboard layout, so a chat keeps running while you move between pages.
 *
 * Every time a chat is first shown, the dashboard asks for a fresh one-time
 * sign-in link (POST /api/instances/[id]/chat-embed): no password reaches the
 * browser, and a copied link is useless a minute later.
 */

type OpenOptions = {
  size?: ChatSize
  /** Opened for the agent that just finished deploying: wait for its chat to start. */
  welcome?: boolean
}

type AgentChatContextValue = {
  openChat: (agent: ChatAgent, options?: OpenOptions) => void
  /** Open the chat at its own address, signed in, in a new tab. */
  openChatInNewTab: (agent: ChatAgent) => void
}

const AgentChatContext = createContext<AgentChatContextValue | null>(null)

/** Open chats outside the dashboard (an agent page rendered elsewhere) fall back to a new tab. */
export function useAgentChat(): AgentChatContextValue {
  return (
    useContext(AgentChatContext) ?? {
      openChat: (agent) => openChatInNewTab(agent),
      openChatInNewTab,
    }
  )
}

const STORAGE_KEY = "atlas.agent-chat.v1"

function loadSaved(): ChatWindows {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    return raw ? restoreChatWindows(JSON.parse(raw)) : EMPTY_CHAT_WINDOWS
  } catch {
    return EMPTY_CHAT_WINDOWS
  }
}

type EmbedResult = { ok: true; url: string; updated: boolean } | { ok: false; error: string; code?: string }

async function requestEmbedLink(agentId: string): Promise<EmbedResult> {
  try {
    const r = await fetch(`/api/instances/${agentId}/chat-embed`, { method: "POST", cache: "no-store" })
    const j = (await r.json().catch(() => ({}))) as { url?: string; updated?: boolean; error?: string; code?: string }
    if (r.ok && typeof j.url === "string") return { ok: true, url: j.url, updated: Boolean(j.updated) }
    return { ok: false, error: j.error ?? `Couldn't open the chat (${r.status}).`, code: j.code }
  } catch {
    return { ok: false, error: "Couldn't reach the dashboard. Check your connection and try again." }
  }
}

function openChatInNewTab(agent: ChatAgent) {
  // Open the tab inside the click, before the await, or the popup blocker
  // eats it; then point it at the link once it arrives.
  const tab = window.open("about:blank", "_blank")
  void requestEmbedLink(agent.id).then((res) => {
    const target = res.ok ? res.url : (agent.publicUrl ?? agent.ipUrl)
    if (!tab) return
    if (!target) {
      tab.close()
      return
    }
    tab.opener = null
    tab.location.href = target
  })
}

export function AgentChatProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ChatWindows>(EMPTY_CHAT_WINDOWS)
  // Chats restored from an earlier page load sign in only when first shown.
  const [shown, setShown] = useState<Set<string>>(() => new Set())
  const [welcome, setWelcome] = useState<Set<string>>(() => new Set())
  const restored = useRef(false)

  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const saved = loadSaved()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved.windows.length > 0) setState(saved)
  }, [])

  useEffect(() => {
    if (!restored.current) return
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* private mode: chats just don't come back after a reload */
    }
  }, [state])

  // The open chat covers the corner where the live-support bubble sits.
  const showing = state.activeId !== null
  useEffect(() => {
    document.body.classList.toggle("agent-chat-open", showing)
    return () => document.body.classList.remove("agent-chat-open")
  }, [showing])

  const openChat = useCallback((agent: ChatAgent, options?: OpenOptions) => {
    setState((s) => openChatWindow(s, agent, Date.now(), options?.size))
    setShown((s) => (s.has(agent.id) ? s : new Set(s).add(agent.id)))
    if (options?.welcome) setWelcome((s) => new Set(s).add(agent.id))
  }, [])

  const value = useMemo(() => ({ openChat, openChatInNewTab }), [openChat])

  const minimized = state.windows.filter((w) => w.agent.id !== state.activeId)

  return (
    <AgentChatContext.Provider value={value}>
      {children}

      {state.windows
        .filter((w) => shown.has(w.agent.id))
        .map((w) => (
          <ChatWindowFrame
            key={w.agent.id}
            agent={w.agent}
            active={w.agent.id === state.activeId}
            size={state.size}
            waitForStart={welcome.has(w.agent.id)}
            onMinimize={() => setState(minimizeChatWindow)}
            onClose={() => {
              setState((s) => closeChatWindow(s, w.agent.id))
              setShown((s) => {
                const next = new Set(s)
                next.delete(w.agent.id)
                return next
              })
            }}
            onResize={(size) => setState((s) => resizeChatWindow(s, size))}
          />
        ))}

      {minimized.length > 0 && (
        <div
          role="region"
          aria-label="Minimized agent chats"
          // Clear of the live-support bubble, which owns the bottom-right
          // corner: above it on a phone, beside it on a wider screen.
          className="fixed right-4 bottom-28 z-40 flex max-w-[calc(100vw-2rem)] flex-wrap-reverse justify-end gap-2 sm:right-24 sm:bottom-5"
        >
          {minimized.map((w) => (
            <div
              key={w.agent.id}
              className="flex items-center rounded-full border border-border bg-card/95 shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-2"
            >
              <button
                type="button"
                onClick={() => openChat(w.agent)}
                className="flex min-w-0 items-center gap-2 rounded-l-full py-1.5 pr-2 pl-2 text-sm text-foreground transition-colors hover:bg-muted"
                title={`Open the chat with ${w.agent.name}`}
              >
                <RuntimeLogo runtime={w.agent.runtime} size={18} className="size-[18px] shrink-0" />
                <span className="max-w-[10rem] truncate font-medium">{w.agent.name}</span>
                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setState((s) => closeChatWindow(s, w.agent.id))
                  setShown((s) => {
                    const next = new Set(s)
                    next.delete(w.agent.id)
                    return next
                  })
                }}
                className="mr-1 flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={`Close the chat with ${w.agent.name}`}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </AgentChatContext.Provider>
  )
}

type FrameState =
  | { kind: "signing-in"; slow: boolean; starting: boolean }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "blocked" }
  | { kind: "error"; message: string; code?: string }

/** How long the chat of an agent that just went live gets to start answering. */
const START_RETRIES = 10
const START_RETRY_MS = 3_000

function ChatWindowFrame({
  agent,
  active,
  size,
  waitForStart,
  onMinimize,
  onClose,
  onResize,
}: {
  agent: ChatAgent
  active: boolean
  size: ChatSize
  waitForStart: boolean
  onMinimize: () => void
  onClose: () => void
  onResize: (size: ChatSize) => void
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [frame, setFrame] = useState<FrameState>({ kind: "signing-in", slow: false, starting: false })
  const [attempt, setAttempt] = useState(0)
  const [model, setModel] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Sign in: a fresh one-time link on every (re)try.
  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    // An agent set up before in-dashboard chat is updated on its first open,
    // which takes a few seconds; say so instead of spinning silently.
    const slowTimer = setTimeout(() => {
      if (!cancelled) setFrame((f) => (f.kind === "signing-in" ? { ...f, slow: true } : f))
    }, 2_500)

    async function signIn(tries: number) {
      const res = await requestEmbedLink(agent.id)
      if (cancelled) return
      if (res.ok) {
        setSrc(res.url)
        setFrame({ kind: "loading" })
        return
      }
      if (waitForStart && res.code === "CHAT_DOWN" && tries < START_RETRIES) {
        setFrame({ kind: "signing-in", slow: false, starting: true })
        retryTimer = setTimeout(() => void signIn(tries + 1), START_RETRY_MS)
        return
      }
      setFrame({ kind: "error", message: res.error, code: res.code })
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrame({ kind: "signing-in", slow: false, starting: false })
    setSrc(null)
    void signIn(0)
    return () => {
      cancelled = true
      clearTimeout(slowTimer)
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [agent.id, attempt, waitForStart])

  // The model the agent runs, for the header (set in Controls → Model).
  useEffect(() => {
    let cancelled = false
    fetch(`/api/instances/${agent.id}/model`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { current: string | null; tierDefault: string; options: { slug: string; label: string }[] } | null) => {
        if (cancelled || !j) return
        const slug = j.current ?? j.tierDefault
        setModel(j.options.find((o) => o.slug === slug)?.label ?? slug)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [agent.id, attempt])

  // AgentWebUI Lite 0.2.1+ says whether the framed sign-in took. A browser
  // that blocks the framed cookie (Safari, private windows) lands on its
  // sign-in page, and the chat is better opened in its own tab.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return
      const data = e.data as { source?: string; signedIn?: boolean } | null
      if (data?.source !== "agentwebui-lite") return
      setFrame((f) => (data.signedIn === false ? { kind: "blocked" } : f.kind === "blocked" ? f : { kind: "ready" }))
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  const host = addressLabel(agent.publicUrl) ?? addressLabel(agent.ipUrl)

  return (
    <section
      role="dialog"
      aria-modal={false}
      aria-label={`Chat with ${agent.name}`}
      hidden={!active}
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden border border-border bg-background shadow-2xl animate-in fade-in zoom-in-[0.98] duration-150",
        "inset-0 sm:rounded-2xl",
        size === "full"
          ? "sm:inset-4"
          : "sm:inset-auto sm:top-4 sm:right-4 sm:bottom-4 sm:w-[min(480px,calc(100vw-2rem))]",
      )}
    >
      <header className="flex items-center gap-3 border-b border-border bg-card px-3 py-2">
        <RuntimeLogo runtime={agent.runtime} size={22} className="size-[22px] shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{agent.name}</p>
          <p className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
            {model ? (
              <>
                <span className="truncate">{model}</span>
                <span aria-hidden>·</span>
                <Link
                  href={`/dashboard/instances/${agent.id}?tab=controls#model`}
                  onClick={onMinimize}
                  className="shrink-0 text-primary hover:underline"
                >
                  Change model
                </Link>
              </>
            ) : (
              <span className="truncate">{host}</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => openChatInNewTab(agent)}
            aria-label="Open in a new tab"
            title={host ? `Open at ${host} in a new tab` : "Open in a new tab"}
          >
            <ExternalLink />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden sm:inline-flex"
            onClick={() => onResize(size === "full" ? "panel" : "full")}
            aria-label={size === "full" ? "Dock to the side" : "Fill the screen"}
            title={size === "full" ? "Dock to the side" : "Fill the screen"}
          >
            {size === "full" ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onMinimize} aria-label="Minimize" title="Minimize">
            <Minus />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close chat" title="Close chat">
            <X />
          </Button>
        </div>
      </header>

      <div className="relative flex-1 bg-background">
        {src && (
          <iframe
            ref={iframeRef}
            src={src}
            title={`Chat with ${agent.name}`}
            className="absolute inset-0 size-full border-0"
            allow="clipboard-read; clipboard-write; microphone"
            onLoad={() => setFrame((f) => (f.kind === "loading" ? { kind: "ready" } : f))}
          />
        )}

        {(frame.kind === "signing-in" || frame.kind === "loading") && (
          <Overlay>
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">
              {frame.kind === "loading"
                ? "Opening the chat…"
                : frame.starting
                  ? "Your agent is live. Starting its chat…"
                  : frame.slow
                    ? "Setting up this agent's chat for the dashboard…"
                    : "Signing you in…"}
            </p>
            {frame.kind === "signing-in" && frame.slow && !frame.starting && (
              <p className="max-w-xs text-xs text-muted-foreground">
                This happens once per agent and takes a few seconds (up to a minute if its chat needs an update).
              </p>
            )}
          </Overlay>
        )}

        {frame.kind === "error" && (
          <Overlay>
            <p className="max-w-sm text-sm text-foreground">{frame.message}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {frame.code !== "NOT_MIGRATED" && frame.code !== "ORIGIN_NOT_ALLOWED" && (
                <Button size="sm" onClick={() => setAttempt((a) => a + 1)}>
                  <RefreshCw data-icon="inline-start" />
                  Try again
                </Button>
              )}
              {(agent.publicUrl || agent.ipUrl) && (
                <Button size="sm" variant="outline" onClick={() => openChatInNewTab(agent)}>
                  <ExternalLink data-icon="inline-start" />
                  Open in a new tab
                </Button>
              )}
            </div>
          </Overlay>
        )}

        {frame.kind === "blocked" && (
          <Overlay>
            <ShieldAlert className="size-6 text-amber-500" />
            <p className="max-w-sm text-sm font-medium text-foreground">
              Your browser kept the chat from signing in inside the dashboard.
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              This happens in Safari and in private windows, which block sign-ins in embedded pages. In a new tab
              the chat signs you in automatically.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => openChatInNewTab(agent)}>
                <ExternalLink data-icon="inline-start" />
                Open in a new tab
              </Button>
              <Button size="sm" variant="outline" onClick={() => setFrame({ kind: "ready" })}>
                Sign in here instead
              </Button>
            </div>
          </Overlay>
        )}
      </div>
    </section>
  )
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center">
      {children}
    </div>
  )
}
