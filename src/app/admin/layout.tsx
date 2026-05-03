import { AdminSidebar } from "@/components/layout/admin-sidebar"
import { DashboardTopbar } from "@/components/layout/dashboard-topbar"

// Admin pages query the DB on every render; never prerender them at build time.
// Cascades to every route under /admin/*.
export const dynamic = "force-dynamic"
export const revalidate = 0

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <AdminSidebar />
      <div className="flex-1 flex flex-col">
        <DashboardTopbar />
        <main className="flex-1 p-6 lg:p-8 overflow-auto bg-[var(--bg-color)]">{children}</main>
      </div>
    </div>
  )
}
