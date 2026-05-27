import { cookies } from "next/headers"

import { AdminSidebar } from "@/components/layout/admin-sidebar"
import { DashboardTopbar } from "@/components/layout/dashboard-topbar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

// Admin pages query the DB on every render; never prerender them at build time.
// Cascades to every route under /admin/*.
export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false"

  return (
    <div className="app-shell flex min-h-screen flex-col bg-background text-foreground">
      <SidebarProvider defaultOpen={defaultOpen} className="flex-1">
        <AdminSidebar />
        <SidebarInset>
          <DashboardTopbar />
          <main className="flex-1 overflow-auto bg-background px-6 py-8 lg:px-12 lg:py-10">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
