import { cookies } from "next/headers"

import { CONSOLE_THEME_COOKIE, type ConsoleTheme } from "@/lib/console-theme"

/** Server-only reader for the console theme cookie (defaults to dark). */
export async function getConsoleTheme(): Promise<ConsoleTheme> {
  const store = await cookies()
  return store.get(CONSOLE_THEME_COOKIE)?.value === "light" ? "light" : "dark"
}
