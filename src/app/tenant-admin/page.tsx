import Link from "next/link"
import { redirect } from "next/navigation"

import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { getTenantConfig } from "@/lib/tenant"
import { getTenantChildTeamIds } from "@/lib/tenant-scope"
import { getAccountHealth, getFleetHealth } from "@/lib/admin-accounts"
import { PageContainer, PageHeader, PageSection } from "@/components/layout/page-container"
import { StatCard } from "@/components/admin/stat-card"
import { StatusBadge } from "@/components/admin/status-badge"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const dynamic = "force-dynamic"

export default async function TenantDashboardPage() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) redirect("/dashboard")

  const teamIds = await getTenantChildTeamIds(admin.tenantTeamId)
  const [accounts, fleet, cfg] = await Promise.all([
    getAccountHealth({ teamIds }),
    getFleetHealth({ teamIds }),
    getTenantConfig(admin.tenantTeamId),
  ])

  const totalAgents = fleet.rows.length
  const runningAgents = fleet.rows.filter((r) => r.status === "running").length
  const totalCustomers = accounts.rows.length
  const suspendedCustomers = accounts.rows.filter((r) => r.suspended).length

  // Reseller readiness signals — surface unconfigured pieces that block the
  // white-label from actually serving customers.
  const readiness = [
    { label: "Own OpenRouter account", ok: Boolean(cfg?.openRouterProvisioningKeyEnc) },
    { label: "Stripe Connect (charges enabled)", ok: Boolean(cfg?.stripeConnectChargesEnabled) },
    { label: "Own Chatwoot support", ok: Boolean(cfg?.chatwootApiTokenEnc) },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Reseller Dashboard"
        description="An overview of your white-label business — customers, agents, and setup."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Customers" value={totalCustomers} href="/tenant-admin/customers" />
        <StatCard
          label="Suspended"
          value={suspendedCustomers}
          tone={suspendedCustomers > 0 ? "warning" : "muted"}
        />
        <StatCard label="Agents" value={totalAgents} href="/tenant-admin/agents" />
        <StatCard
          label="Running"
          value={runningAgents}
          tone={runningAgents > 0 ? "positive" : "muted"}
        />
      </div>

      <PageSection
        title="Account health"
        description="Health across your customers — worst-of their agents, escalated for suspension or payment issues."
      >
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <StatCard label="Healthy" value={accounts.counts.healthy} tone="positive" />
          <StatCard label="At risk" value={accounts.counts.at_risk} tone="warning" />
          <StatCard label="Churn risk" value={accounts.counts.churn_risk} tone="danger" />
        </div>
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Agents</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Health</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No customers yet.
                  </TableCell>
                </TableRow>
              ) : (
                accounts.rows.slice(0, 25).map((r) => (
                  <TableRow key={r.teamId}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.ownerEmail}</TableCell>
                    <TableCell className="font-mono">{r.agents}</TableCell>
                    <TableCell className="font-mono">{r.members}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.suspended ? "churn_risk" : r.tier} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </PageSection>

      <PageSection
        title="Setup"
        description="Complete these to serve customers on your own infrastructure and billing."
      >
        <Card size="sm" className="divide-y divide-border p-0">
          {readiness.map((r) => (
            <div key={r.label} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm">{r.label}</span>
              <StatusBadge status={r.ok ? "ready" : "pending"} />
            </div>
          ))}
          <div className="px-4 py-3">
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/tenant-admin/settings">Open settings</Link>}
            />
          </div>
        </Card>
      </PageSection>
    </PageContainer>
  )
}
