"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useTheme } from "next-themes"
import { X } from "lucide-react"

import {
  isLiveChatHidden,
  onLiveChatVisibilityChange,
  setLiveChatHidden,
} from "@/lib/live-chat"

type WidgetConfig = { baseUrl: string; websiteToken: string }

/**
 * Loads the Chatwoot live-chat widget and keeps the chat contact in sync with
 * the NextAuth session. Which Chatwoot loads is resolved server-side per team /
 * per custom domain (a white-label tenant's own Chatwoot on their domain, else
 * the platform's) via /api/support/widget-config — so this works for anonymous
 * visitors too. Renders nothing and no-ops when no Chatwoot is configured.
 */
export function ChatwootWidget() {
  const { data: session, status } = useSession()
  const { resolvedTheme } = useTheme()
  const identifiedRef = useRef<string | null>(null)
  const [cfg, setCfg] = useState<WidgetConfig | null>(null)
  // The authenticated console is a theme island driven by the `console-theme`
  // cookie (mirrored onto `<html data-console-theme>` by ConsoleThemePortalSync),
  // independent of next-themes. Prefer it when present so the widget matches the
  // console; fall back to next-themes on the marketing site.
  const [consoleTheme, setConsoleTheme] = useState<string | null>(null)
  // Lazy init is SSR-safe (returns false on the server). The first render emits
  // null regardless — `cfg` is null until the config fetch resolves — so reading
  // localStorage here can't cause a hydration mismatch.
  const [hidden, setHidden] = useState(isLiveChatHidden)

  // Resolve which Chatwoot to load (per team / custom domain), then inject the
  // SDK exactly once.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch("/api/support/widget-config", { credentials: "include" })
        const data = res.ok ? await res.json() : null
        const widget: WidgetConfig | null = data?.widget ?? null
        if (cancelled || !widget) return
        setCfg(widget)
        if (document.getElementById("chatwoot-sdk")) return
        const script = document.createElement("script")
        script.id = "chatwoot-sdk"
        script.src = `${widget.baseUrl}/packs/js/sdk.js`
        script.async = true
        script.defer = true
        script.onload = () => {
          window.chatwootSDK?.run({ websiteToken: widget.websiteToken, baseUrl: widget.baseUrl })
        }
        document.body.appendChild(script)
      } catch {
        /* no widget — fine */
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // Identify (or reset) the contact whenever auth state changes. The widget may
  // not be ready yet, so also re-sync when Chatwoot fires `chatwoot:ready`.
  useEffect(() => {
    if (!cfg) return

    async function sync() {
      const cw = window.$chatwoot
      if (!cw) return

      if (status === "authenticated" && session?.user?.id) {
        if (identifiedRef.current === session.user.id) return
        try {
          const res = await fetch("/api/support/identity", { credentials: "include" })
          const data = res.ok ? await res.json() : null
          cw.setUser(session.user.id, {
            name: session.user.name ?? undefined,
            email: session.user.email ?? undefined,
            identifier_hash: data?.hash ?? undefined,
          })
          identifiedRef.current = session.user.id
        } catch {
          /* widget stays usable anonymously */
        }
      } else if (status === "unauthenticated" && identifiedRef.current) {
        cw.reset()
        identifiedRef.current = null
      }
    }

    void sync()
    const onReady = () => void sync()
    window.addEventListener("chatwoot:ready", onReady)
    return () => window.removeEventListener("chatwoot:ready", onReady)
  }, [session, status, cfg])

  // Track the console theme island (`<html data-console-theme>`); it's absent on
  // the marketing site, where next-themes drives appearance instead.
  useEffect(() => {
    const read = () =>
      setConsoleTheme(document.documentElement.getAttribute("data-console-theme"))
    read()
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-console-theme"],
    })
    return () => obs.disconnect()
  }, [])

  // Effective dark state: the console theme wins when on a console surface,
  // otherwise the global next-themes value.
  const isDark = consoleTheme ? consoleTheme === "dark" : resolvedTheme === "dark"

  // Keep the widget's light/dark appearance in sync with the app theme. The
  // iframe may not be ready on first render, so re-apply on `chatwoot:ready`.
  useEffect(() => {
    if (!cfg) return
    const apply = () =>
      window.$chatwoot?.setColorScheme(isDark ? "dark" : "light")
    apply()
    window.addEventListener("chatwoot:ready", apply)
    return () => window.removeEventListener("chatwoot:ready", apply)
  }, [isDark, cfg])

  // React to hide/show broadcasts from elsewhere (the "Live chat" button on the
  // Support page brings the bubble back).
  useEffect(() => onLiveChatVisibilityChange(setHidden), [])

  // Show or hide the chat bubble to match the preference. The iframe may not be
  // ready on first render, so re-apply on `chatwoot:ready` too.
  useEffect(() => {
    if (!cfg) return
    const apply = () =>
      window.$chatwoot?.toggleBubbleVisibility(hidden ? "hide" : "show")
    apply()
    window.addEventListener("chatwoot:ready", apply)
    return () => window.removeEventListener("chatwoot:ready", apply)
  }, [hidden, cfg])

  // Nothing to overlay until the widget is configured, and no close affordance
  // once the user has hidden it.
  if (!cfg || hidden) return null

  return (
    <button
      type="button"
      aria-label="Hide live chat"
      title="Hide live chat — turn it back on anytime from Support"
      onClick={() => setLiveChatHidden(true)}
      // Sits just above the Chatwoot bubble's top-right corner. Chatwoot's
      // launcher uses z-index 2147483000, so layer one above it.
      style={{ zIndex: 2147483001 }}
      className="fixed bottom-[76px] right-[18px] flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-md transition-colors hover:bg-muted hover:text-foreground"
    >
      <X className="size-3" />
    </button>
  )
}
