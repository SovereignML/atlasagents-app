"use client"

import { useEffect, useRef } from "react"

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      reset: (id?: string) => void
      remove: (id?: string) => void
    }
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

// Module-level cached promise so the CF script is injected at most once even
// when several widgets mount (e.g. fast client navigation between auth pages).
let scriptPromise: Promise<void> | null = null
function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve) => {
    const s = document.createElement("script")
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    document.head.appendChild(s)
  })
  return scriptPromise
}

export interface TurnstileWidgetProps {
  /** Fired with the verification token once the challenge passes. */
  onVerify: (token: string) => void
  /** Fired when the token expires (the widget auto-resets). */
  onExpire?: () => void
}

/**
 * Cloudflare Turnstile widget. Renders nothing when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset, so the auth forms degrade gracefully
 * in dev. Wrap `onVerify`/`onExpire` in useCallback in the parent to avoid
 * re-rendering the widget on every keystroke.
 */
export function TurnstileWidget({ onVerify, onExpire }: TurnstileWidgetProps) {
  const ref = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)

  useEffect(() => {
    if (!SITE_KEY) return
    let cancelled = false

    loadTurnstileScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        theme: "dark",
        callback: (token: string) => onVerify(token),
        "expired-callback": () => {
          onExpire?.()
          if (widgetId.current) window.turnstile?.reset(widgetId.current)
        },
        "error-callback": () => {
          if (widgetId.current) window.turnstile?.reset(widgetId.current)
        },
      })
    })

    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current)
        widgetId.current = null
      }
    }
  }, [onVerify, onExpire])

  if (!SITE_KEY) return null
  return <div ref={ref} className="flex justify-center" />
}
