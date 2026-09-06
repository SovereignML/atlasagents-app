/**
 * Console theme is scoped to the authenticated "operations console" surfaces
 * (dashboard, admin, tenant-admin, auth) and is independent of the global
 * `next-themes` theme that drives the marketing site. The console defaults to
 * dark (the Atlas Agents console design) but can be toggled to the light console
 * palette; the choice is persisted in a cookie so the server renders the correct
 * `.dark` wrapper with no flash.
 *
 * This module is client-safe (constant + type only). The server-only reader
 * lives in `console-theme.server.ts` so it can pull in `next/headers` without
 * leaking that into client bundles.
 */
export type ConsoleTheme = "dark" | "light"

export const CONSOLE_THEME_COOKIE = "console-theme"
