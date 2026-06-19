"use client"

import { useRouter } from "next/navigation"
import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CONSOLE_THEME_COOKIE, type ConsoleTheme } from "@/lib/console-theme"

/**
 * Console-scoped theme toggle. Writes the `console-theme` cookie and refreshes
 * so the server re-renders the layout's `.dark` wrapper — keeping the marketing
 * site's global `next-themes` theme completely untouched. The current value is
 * passed from the server so the icon is correct on first paint (no flash).
 */
export function ConsoleThemeToggle({
  theme,
  className,
}: {
  theme: ConsoleTheme
  className?: string
}) {
  const router = useRouter()
  const isDark = theme === "dark"

  function toggle() {
    const next: ConsoleTheme = isDark ? "light" : "dark"
    document.cookie = `${CONSOLE_THEME_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`
    router.refresh()
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      className={className}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  )
}
