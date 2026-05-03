import { DashboardSidebar } from "@/components/layout/dashboard-sidebar"
import { DashboardTopbar } from "@/components/layout/dashboard-topbar"
import { ImpersonationBanner } from "@/components/layout/impersonation-banner"
import { getImpersonatedUserId } from "@/lib/impersonation"
import { auth } from "@/auth"
import { db, users, eq } from "@/db"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin"
  const impersonatedId = isAdmin ? await getImpersonatedUserId() : null

  let impersonatedUser: { id: string; email: string; name: string | null } | null = null
  if (impersonatedId) {
    const u = await db.query.users.findFirst({
      where: eq(users.id, impersonatedId),
      columns: { id: true, email: true, name: true },
    })
    if (u) impersonatedUser = u
  }

  return (
    <div className="min-h-screen flex flex-col">
      {impersonatedUser && (
        <ImpersonationBanner
          userId={impersonatedUser.id}
          email={impersonatedUser.email}
          name={impersonatedUser.name}
        />
      )}
      <div className="flex-1 flex">
        <DashboardSidebar />
        <div className="flex-1 flex flex-col">
          <DashboardTopbar />
          <main className="flex-1 p-6 lg:p-8 overflow-auto bg-[var(--bg-color)]">{children}</main>
        </div>
      </div>
    </div>
  )
}
