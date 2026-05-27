import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"

import { db, eq, teamBranding } from "@/db"
import { getUserTeam, canManageTeam } from "@/lib/team"
import { teamHasWhiteLabel } from "@/lib/white-label"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { BrandingClient, type BrandingState } from "./branding-client"

export const dynamic = "force-dynamic"

export default async function BrandingSettingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const ctx = await getUserTeam(session.user.id)
  if (!ctx) redirect("/dashboard")

  // Owner/admin only.
  if (!canManageTeam(ctx.role)) {
    return (
      <PageContainer>
        <PageHeader title="Branding" />
        <Card>
          <CardHeader>
            <CardTitle>Not available</CardTitle>
            <CardDescription>
              Only team owners and admins can manage white-label branding.
            </CardDescription>
          </CardHeader>
        </Card>
      </PageContainer>
    )
  }

  // Gated on an active Scale/Enterprise subscription.
  if (!(await teamHasWhiteLabel(ctx.teamId))) {
    return (
      <PageContainer>
        <PageHeader title="Branding" />
        <Card>
          <CardHeader>
            <CardTitle>White-label is a Scale & Enterprise feature</CardTitle>
            <CardDescription>
              Upgrade your plan to brand the dashboard with your own name, logo,
              colors, and custom domain.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/dashboard/billing">View plans</Link>} />
          </CardContent>
        </Card>
      </PageContainer>
    )
  }

  const row = await db.query.teamBranding.findFirst({
    where: eq(teamBranding.teamId, ctx.teamId),
  })

  const initial: BrandingState = {
    brandName: row?.brandName ?? "",
    supportEmail: row?.supportEmail ?? "",
    logoUrl: row?.logoUrl ?? "",
    logoMarkUrl: row?.logoMarkUrl ?? "",
    faviconUrl: row?.faviconUrl ?? "",
    primaryLight: row?.primaryLight ?? "",
    accentLight: row?.accentLight ?? "",
    primaryDark: row?.primaryDark ?? "",
    accentDark: row?.accentDark ?? "",
    brandingEnabled: row?.brandingEnabled ?? true,
  }

  return <BrandingClient initial={initial} />
}
