import { type ConsoleTheme } from "@/lib/console-theme"

/**
 * Server-only reader for the console theme.
 *
 * Light mode is hidden for now: the console is hard-locked to dark regardless of
 * any persisted `console-theme` cookie. To restore the toggle, revert this to
 * read the cookie (see git history) and re-add <ConsoleThemeToggle /> to the
 * dashboard topbar.
 */
export async function getConsoleTheme(): Promise<ConsoleTheme> {
  return "dark"
}
