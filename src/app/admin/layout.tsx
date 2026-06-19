import { cookies } from "next/headers"

import { AdminSidebar } from "@/components/layout/admin-sidebar"
import { DashboardTopbar } from "@/components/layout/dashboard-topbar"
import { ConsoleThemePortalSync } from "@/components/layout/console-theme-portal-sync"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getConsoleTheme } from "@/lib/console-theme.server"

// Admin pages query the DB on every render; never prerender them at build time.
// Cascades to every route under /admin/*.
export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false"
  const consoleTheme = await getConsoleTheme()

  return (
    <div
      className={`app-shell flex min-h-screen flex-col bg-background text-foreground ${
        consoleTheme === "dark" ? "console-dark" : "console-light"
      }`}
    >
      <ConsoleThemePortalSync theme={consoleTheme} />
      <SidebarProvider defaultOpen={defaultOpen} className="flex-1">
        <AdminSidebar />
        <SidebarInset>
          <DashboardTopbar consoleTheme={consoleTheme} />
          <main className="flex-1 overflow-auto bg-background px-8 pt-[30px] pb-[60px]">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
