import { redirect } from "next/navigation"

import { db, and, inArray, sql, memberships, instances, notInArray } from "@/db"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { listChildTeams } from "@/lib/tenant"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { CustomersClient, type Customer } from "../customers-client"

export const dynamic = "force-dynamic"

export default async function TenantCustomersPage() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) redirect("/dashboard")

  const children = await listChildTeams(admin.tenantTeamId)
  const ids = children.map((c) => c.id)

  const agentCounts = new Map<string, number>()
  const memberCounts = new Map<string, number>()
  if (ids.length) {
    const agentRows = await db
      .select({ teamId: instances.teamId, count: sql<number>`count(*)` })
      .from(instances)
      .where(and(inArray(instances.teamId, ids), notInArray(instances.status, ["deleted"])))
      .groupBy(instances.teamId)
    for (const r of agentRows) agentCounts.set(r.teamId, Number(r.count))

    const memberRows = await db
      .select({ teamId: memberships.teamId, count: sql<number>`count(*)` })
      .from(memberships)
      .where(inArray(memberships.teamId, ids))
      .groupBy(memberships.teamId)
    for (const r of memberRows) memberCounts.set(r.teamId, Number(r.count))
  }

  const customers: Customer[] = children.map((c) => ({
    id: c.id,
    name: c.name,
    suspended: c.suspendedAt != null,
    agentLimit: c.agentLimit,
    seatLimit: c.seatLimit,
    agents: agentCounts.get(c.id) ?? 0,
    members: memberCounts.get(c.id) ?? 0,
    createdAt: c.createdAt.toISOString(),
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Customers"
        description="End-customer accounts under your white-label. New customers can self-register on your custom domain."
      />
      <CustomersClient customers={customers} />
    </PageContainer>
  )
}
