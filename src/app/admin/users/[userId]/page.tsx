import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { db, eq, users } from "@/db"
import { requireAdminPage } from "@/lib/admin-guard"
import { getFreeTierUsage, FREE_LIFETIME_LIMIT } from "@/lib/free-tier"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageContainer, PageHeader, PageSection } from "@/components/layout/page-container"
import { StatCard } from "@/components/admin/stat-card"
import { FreeTierControl } from "./free-tier-control"

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  await requireAdminPage()
  const { userId } = await params

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  if (!user) notFound()

  const usage = await getFreeTierUsage(userId)
  const remaining = Math.max(0, usage.limit - usage.lifetimeCount)

  return (
    <PageContainer>
      <Link
        href="/admin/users"
        className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All users
      </Link>

      <PageHeader
        title={user.name || user.email}
        description={user.name ? user.email : "User detail"}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={user.role === "admin" ? "outline" : "secondary"}>
          {user.role}
        </Badge>
        {user.isBanned && <Badge variant="destructive">banned</Badge>}
        {usage.exhausted && <Badge variant="destructive">free tier exhausted</Badge>}
      </div>

      <PageSection title="Free tier">
        <div className="grid gap-5 sm:grid-cols-3">
          <StatCard
            label="Free agents used"
            value={`${usage.lifetimeCount} / ${usage.limit}`}
            tone={usage.exhausted ? "warning" : "accent"}
            hint="lifetime demo agents deployed"
          />
          <StatCard
            label="Remaining"
            value={remaining}
            tone={remaining === 0 ? "warning" : "positive"}
            hint="before Free is removed for them"
          />
          <StatCard
            label="Limit source"
            value={usage.limitOverride === null ? "default" : "custom"}
            tone="muted"
            hint={
              usage.limitOverride === null
                ? `platform default (${FREE_LIFETIME_LIMIT})`
                : `admin override (${usage.limitOverride})`
            }
          />
        </div>

        <Card className="mt-5">
          <CardHeader>
            <CardTitle className="text-base">Adjust free-agent limit</CardTitle>
          </CardHeader>
          <CardContent>
            <FreeTierControl
              userId={userId}
              defaultLimit={FREE_LIFETIME_LIMIT}
              limitOverride={usage.limitOverride}
              lifetimeCount={usage.lifetimeCount}
            />
          </CardContent>
        </Card>

        {usage.activeRuntimes.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Currently running free agents: {usage.activeRuntimes.join(", ")}
          </p>
        )}
      </PageSection>
    </PageContainer>
  )
}
