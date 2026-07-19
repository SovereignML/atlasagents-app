import { redirect } from "next/navigation"

import { db, inArray, eq, desc, memberships, users } from "@/db"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { getTenantChildTeamIds, getChildTeamNameMap } from "@/lib/tenant-scope"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { UsersClient, type UserRow } from "./users-client"

export const dynamic = "force-dynamic"

export default async function TenantUsersPage() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) redirect("/dashboard")

  const childIds = await getTenantChildTeamIds(admin.tenantTeamId)
  const teamNames = await getChildTeamNameMap(admin.tenantTeamId)

  let rows: UserRow[] = []
  if (childIds.length) {
    const memberRows = await db
      .select({
        userId: memberships.userId,
        teamId: memberships.teamId,
        role: memberships.role,
        joinedAt: memberships.createdAt,
        name: users.name,
        email: users.email,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(inArray(memberships.teamId, childIds))
      .orderBy(desc(memberships.createdAt))

    rows = memberRows.map((r) => ({
      userId: r.userId,
      teamId: r.teamId,
      name: r.name,
      email: r.email,
      customer: teamNames.get(r.teamId) ?? "-",
      role: r.role,
      joinedAt: r.joinedAt.toISOString(),
    }))
  }

  return (
    <PageContainer>
      <PageHeader
        title="Users"
        description="Everyone across your end-customer teams. Send a password reset when a customer is locked out."
      />
      <UsersClient users={rows} />
    </PageContainer>
  )
}
