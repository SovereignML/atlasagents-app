import { redirect } from "next/navigation"

import { db, and, inArray, eq, instances } from "@/db"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { getTenantChildTeamIds, getChildTeamNameMap } from "@/lib/tenant-scope"
import { PageContainer, PageHeader, PageSection } from "@/components/layout/page-container"
import { StatCard } from "@/components/admin/stat-card"
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

function monthlyEquiv(billingInterval: string, priceMonthly: number, priceYearly: number): number {
  return billingInterval === "year" ? priceYearly / 12 : priceMonthly
}

export default async function TenantRevenuePage() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) redirect("/dashboard")

  const [childIds, teamNames] = await Promise.all([
    getTenantChildTeamIds(admin.tenantTeamId),
    getChildTeamNameMap(admin.tenantTeamId),
  ])

  const runningInstances = childIds.length
    ? await db.query.instances.findMany({
        where: and(inArray(instances.teamId, childIds), eq(instances.status, "running")),
        with: { serverConfig: true },
      })
    : []

  const totalMonthly = runningInstances.reduce(
    (sum, inst) =>
      sum + monthlyEquiv(inst.billingInterval, inst.serverConfig.priceMonthly, inst.serverConfig.priceYearly),
    0,
  )

  // Per-customer breakdown (only customers with running agents).
  const byCustomer = new Map<string, { agents: number; monthly: number }>()
  for (const inst of runningInstances) {
    const entry = byCustomer.get(inst.teamId) ?? { agents: 0, monthly: 0 }
    entry.agents += 1
    entry.monthly += monthlyEquiv(
      inst.billingInterval,
      inst.serverConfig.priceMonthly,
      inst.serverConfig.priceYearly,
    )
    byCustomer.set(inst.teamId, entry)
  }

  const customerRows = Array.from(byCustomer.entries())
    .map(([teamId, v]) => ({
      teamId,
      name: teamNames.get(teamId) ?? "—",
      agents: v.agents,
      monthly: v.monthly,
    }))
    .sort((a, b) => b.monthly - a.monthly)

  return (
    <PageContainer>
      <PageHeader
        title="Revenue"
        description="Estimated compute across your customers — your cost/usage view of their running agents."
      />

      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard
          label="Est. monthly compute"
          value={`$${totalMonthly.toFixed(2)}`}
          tone="accent"
          hint="Across your customers"
        />
        <StatCard label="Running agents" value={runningInstances.length} />
        <StatCard label="Customers" value={childIds.length} />
      </div>

      <PageSection
        title="Per-customer compute"
        description="Estimated monthly compute spend for each of your end-customers."
      >
        {customerRows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No running agents</EmptyTitle>
              <EmptyDescription>
                Compute usage will appear here once your customers have running agents.
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
                    <TableHead className="text-center">Running agents</TableHead>
                    <TableHead className="text-right">Monthly compute</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerRows.map((row) => (
                    <TableRow key={row.teamId}>
                      <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {row.agents}
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground">
                        ${row.monthly.toFixed(2)}/mo
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
