import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { TenantAdminSidebar } from "@/components/layout/tenant-admin-sidebar"
import { DashboardTopbar } from "@/components/layout/dashboard-topbar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"

// Tenant-admin pages query the DB on every render; never prerender.
export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function TenantAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Gate the whole panel: enterprise-entitled owner/admin only. Individual
  // pages/routes re-check, but this gives a clean redirect for the UI.
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) redirect("/dashboard")

  const cookieStore = await cookies()
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false"

  return (
    <div className="app-shell flex min-h-screen flex-col bg-background text-foreground">
      <SidebarProvider defaultOpen={defaultOpen} className="flex-1">
        <TenantAdminSidebar />
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
