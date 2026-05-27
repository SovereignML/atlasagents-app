"use client"

import { useEffect, useRef } from "react"
import { useSession } from "next-auth/react"
import { useTheme } from "next-themes"

const baseUrl = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL?.replace(/\/$/, "")
const websiteToken = process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN

/**
 * Loads the Chatwoot live-chat widget site-wide and keeps the chat contact in
 * sync with the NextAuth session. Renders nothing and no-ops entirely when the
 * public env vars are unset, so it's safe to mount unconditionally.
 */
export function ChatwootWidget() {
  const { data: session, status } = useSession()
  const { resolvedTheme } = useTheme()
  const identifiedRef = useRef<string | null>(null)

  // Inject the SDK exactly once.
  useEffect(() => {
    if (!baseUrl || !websiteToken) return
    if (document.getElementById("chatwoot-sdk")) return

    const script = document.createElement("script")
    script.id = "chatwoot-sdk"
    script.src = `${baseUrl}/packs/js/sdk.js`
    script.async = true
    script.defer = true
    script.onload = () => {
      window.chatwootSDK?.run({ websiteToken, baseUrl })
    }
    document.body.appendChild(script)
  }, [])

  // Identify (or reset) the contact whenever auth state changes. The widget may
  // not be ready yet, so also re-sync when Chatwoot fires `chatwoot:ready`.
  useEffect(() => {
    if (!baseUrl || !websiteToken) return

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
  }, [session, status])

  // Keep the widget's light/dark appearance in sync with the app theme. The
  // iframe may not be ready on first render, so re-apply on `chatwoot:ready`.
  useEffect(() => {
    if (!baseUrl || !websiteToken) return
    const apply = () =>
      window.$chatwoot?.setColorScheme(resolvedTheme === "dark" ? "dark" : "light")
    apply()
    window.addEventListener("chatwoot:ready", apply)
    return () => window.removeEventListener("chatwoot:ready", apply)
  }, [resolvedTheme])

  return null
}
