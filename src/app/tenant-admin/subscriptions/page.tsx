import { redirect } from "next/navigation"

import { db, inArray, desc, subscriptions } from "@/db"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { getTenantChildTeamIds, getChildTeamNameMap } from "@/lib/tenant-scope"
import { PageContainer, PageHeader, PageSection } from "@/components/layout/page-container"
import { StatCard } from "@/components/admin/stat-card"
import { StatusBadge } from "@/components/admin/status-badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const dynamic = "force-dynamic"

function formatDate(value: Date | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export default async function TenantSubscriptionsPage() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) redirect("/dashboard")

  const [childIds, teamNames] = await Promise.all([
    getTenantChildTeamIds(admin.tenantTeamId),
    getChildTeamNameMap(admin.tenantTeamId),
  ])

  const subs = childIds.length
    ? await db.query.subscriptions.findMany({
        where: inArray(subscriptions.teamId, childIds),
        orderBy: desc(subscriptions.createdAt),
      })
    : []

  const activeCount = subs.filter((s) => s.status === "active").length
  const pastDueCount = subs.filter((s) => s.status === "past_due").length

  return (
    <PageContainer>
      <PageHeader
        title="Subscriptions"
        description="Subscriptions across your end-customers, billed on your connected Stripe account."
      />

      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard label="Total subscriptions" value={subs.length} />
        <StatCard label="Active" value={activeCount} tone="positive" />
        <StatCard
          label="Past due"
          value={pastDueCount}
          tone={pastDueCount > 0 ? "warning" : "muted"}
        />
      </div>

      <PageSection title="Customer Subscriptions">
        {subs.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No subscriptions yet</EmptyTitle>
              <EmptyDescription>
                Subscriptions from your end-customers will appear here once they subscribe.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Card className="overflow-hidden p-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Current period end</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.map((sub) => (
                    <TableRow key={sub.id}>
                      <TableCell className="font-medium text-foreground">
                        {sub.teamId ? teamNames.get(sub.teamId) ?? "—" : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={sub.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {sub.connectAccountId ? "Reseller (Connect)" : "Platform"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(sub.currentPeriodEnd)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(sub.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </PageSection>
    </PageContainer>
  )
}
