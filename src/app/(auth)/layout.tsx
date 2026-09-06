import Link from "next/link"

import { BRANDING } from "@/configs/branding"
import { getConsoleTheme } from "@/lib/console-theme.server"
import { ConsoleThemePortalSync } from "@/components/layout/console-theme-portal-sync"

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const consoleTheme = await getConsoleTheme()
  return (
    <div
      className={`app-shell flex min-h-screen items-center justify-center bg-background px-5 py-12 text-foreground ${
        consoleTheme === "dark" ? "console-dark" : "console-light"
      }`}
    >
      <ConsoleThemePortalSync theme={consoleTheme} />
      <div className="relative z-10 w-full max-w-lg space-y-8">
        <div className="text-center">
          <Link href="/" className="inline-block text-2xl font-bold text-foreground">
            {BRANDING.name}
          </Link>
        </div>
        {children}
      </div>
    </div>
  )
}
