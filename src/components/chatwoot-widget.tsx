"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useTheme } from "next-themes"

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

  // Keep the widget's light/dark appearance in sync with the app theme. The
  // iframe may not be ready on first render, so re-apply on `chatwoot:ready`.
  useEffect(() => {
    if (!cfg) return
    const apply = () =>
      window.$chatwoot?.setColorScheme(resolvedTheme === "dark" ? "dark" : "light")
    apply()
    window.addEventListener("chatwoot:ready", apply)
    return () => window.removeEventListener("chatwoot:ready", apply)
  }, [resolvedTheme, cfg])

  return null
}
