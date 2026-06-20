"use client"

import { useEffect } from "react"

import type { ConsoleTheme } from "@/lib/console-theme"

/**
 * Portaled popups (dialogs, alert-dialogs, dropdowns, selects, popovers,
 * sheets, tooltips) mount at `document.body` — OUTSIDE the `.app-shell` wrapper
 * that carries the console theme tokens. Without help they fall back to the
 * marketing `:root` palette, e.g. a white modal while the console is in dark
 * mode.
 *
 * This mirrors the active console theme onto `<html>` as `data-console-theme`
 * while a console surface is mounted; globals.css re-declares the console tokens
 * under `html[data-console-theme=…]` so portaled content inherits them. The
 * attribute is removed on unmount (navigating back to the marketing site) so the
 * global next-themes palette there is left untouched.
 */
export function ConsoleThemePortalSync({ theme }: { theme: ConsoleTheme }) {
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute("data-console-theme", theme)
    return () => root.removeAttribute("data-console-theme")
  }, [theme])

  return null
}
