import { cache } from "react"
import type { Metadata } from "next"
import { cookies, headers } from "next/headers"

import { DashboardSidebar } from "@/components/layout/dashboard-sidebar"
import { DashboardTopbar } from "@/components/layout/dashboard-topbar"
import { ImpersonationBanner } from "@/components/layout/impersonation-banner"
import { VerifyEmailBanner } from "@/components/dashboard/verify-email-banner"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getEffectiveUserId, getHonoredImpersonatedUserId } from "@/lib/effective-user"
import { getUserTeam, canManageTeam, listUserTeams } from "@/lib/team"
import { teamHasWhiteLabel } from "@/lib/white-label"
import {
  buildBrandingCss,
  getDefaultBranding,
  getTenantBrandingByTeam,
  resolveTeamByHost,
  type ResolvedBranding,
} from "@/lib/tenant-branding"
import { db, users, eq } from "@/db"

export const dynamic = "force-dynamic"
export const revalidate = 0

// Resolve white-label branding once per request (shared by generateMetadata and
// the layout body via React cache). Custom-domain access resolves the team by
// host; canonical access falls back to the user's active team.
const resolveBranding = cache(async (): Promise<ResolvedBranding> => {
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host")

  const hostTeamId = await resolveTeamByHost(host)
  if (hostTeamId) return getTenantBrandingByTeam(hostTeamId)

  const userId = await getEffectiveUserId()
  if (!userId) return getDefaultBranding()
  const team = await getUserTeam(userId)
  if (!team) return getDefaultBranding()
  return getTenantBrandingByTeam(team.teamId)
})

export async function generateMetadata(): Promise<Metadata> {
  const branding = await resolveBranding()
  return {
    title: { default: branding.brandName, template: `%s · ${branding.brandName}` },
    ...(branding.faviconUrl ? { icons: { icon: branding.faviconUrl } } : {}),
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Honors both platform-admin and tenant-admin impersonation (scope re-checked).
  const impersonatedId = await getHonoredImpersonatedUserId()

  let impersonatedUser: { id: string; email: string; name: string | null } | null = null
  if (impersonatedId) {
    const u = await db.query.users.findFirst({
      where: eq(users.id, impersonatedId),
      columns: { id: true, email: true, name: true },
    })
    if (u) impersonatedUser = u
  }

  const cookieStore = await cookies()
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false"

  const branding = await resolveBranding()
  const brandingCss = buildBrandingCss(branding)

  // Show the Branding nav item only to owners/admins of an entitled team
  // (based on the user's active team, independent of the host being viewed).
  let canManageBranding = false
  let teamList: { teamId: string; name: string; role: string }[] = []
  let activeTeamId: string | undefined
  // Show the soft "verify your email" banner only for an unverified credentials
  // user viewing their OWN dashboard. OAuth-only users have a null hashedPassword
  // (and are auto-verified anyway), so they never qualify; hidden while
  // impersonating to avoid confusing an admin with someone else's prompt.
  let showVerifyBanner = false
  const effectiveUserId = await getEffectiveUserId()
  if (effectiveUserId) {
    const managedTeam = await getUserTeam(effectiveUserId)
    activeTeamId = managedTeam?.teamId
    if (managedTeam && canManageTeam(managedTeam.role)) {
      canManageBranding = await teamHasWhiteLabel(managedTeam.teamId)
    }
    teamList = await listUserTeams(effectiveUserId)

    if (!impersonatedUser) {
      const u = await db.query.users.findFirst({
        where: eq(users.id, effectiveUserId),
        columns: { emailVerified: true, hashedPassword: true },
      })
      showVerifyBanner = !!u && u.emailVerified == null && u.hashedPassword != null
    }
  }

  return (
    <div className="app-shell flex min-h-screen flex-col bg-background text-foreground">
      {brandingCss && <style dangerouslySetInnerHTML={{ __html: brandingCss }} />}
      {impersonatedUser && (
        <ImpersonationBanner
          userId={impersonatedUser.id}
          email={impersonatedUser.email}
          name={impersonatedUser.name}
        />
      )}
      <SidebarProvider defaultOpen={defaultOpen} className="flex-1">
        <DashboardSidebar
          brandName={branding.brandName}
          logoUrl={branding.logoUrl}
          logoMarkUrl={branding.logoMarkUrl}
          canManageBranding={canManageBranding}
          canManageTenant={canManageBranding}
        />
        <SidebarInset>
          <DashboardTopbar
            brandName={branding.brandName}
            teams={teamList}
            activeTeamId={activeTeamId}
          />
          <main className="flex-1 overflow-auto bg-background px-6 py-8 lg:px-12 lg:py-10">
            {showVerifyBanner && <VerifyEmailBanner />}
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
