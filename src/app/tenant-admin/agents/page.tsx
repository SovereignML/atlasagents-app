import { redirect } from "next/navigation"

import { db, and, inArray, eq, desc, instances, users, notInArray } from "@/db"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { listChildTeams } from "@/lib/tenant"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { AgentsClient, type AgentRow } from "./agents-client"

export const dynamic = "force-dynamic"

export default async function TenantAgentsPage() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) redirect("/dashboard")

  const children = await listChildTeams(admin.tenantTeamId)
  const teamNames = new Map(children.map((c) => [c.id, c.name]))
  const ids = children.map((c) => c.id)

  let rows: AgentRow[] = []
  if (ids.length) {
    const agentRows = await db
      .select({
        id: instances.id,
        name: instances.name,
        status: instances.status,
        teamId: instances.teamId,
        userId: instances.userId,
        ownerName: users.name,
        ownerEmail: users.email,
      })
      .from(instances)
      .leftJoin(users, eq(users.id, instances.userId))
      .where(and(inArray(instances.teamId, ids), notInArray(instances.status, ["deleted"])))
      .orderBy(desc(instances.createdAt))

    rows = agentRows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      customer: teamNames.get(r.teamId) ?? "-",
      ownerUserId: r.userId,
      ownerEmail: r.ownerEmail ?? "",
      ownerName: r.ownerName ?? null,
    }))
  }

  return (
    <PageContainer>
      <PageHeader
        title="Agents"
        description="Every agent across your end-customers. Impersonate a customer to manage their agents directly."
      />
      <AgentsClient agents={rows} />
    </PageContainer>
  )
}
