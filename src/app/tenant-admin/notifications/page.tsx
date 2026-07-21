import { redirect } from "next/navigation"

import { db, and, or, inArray, gte, desc, eq, sql, auditLogs, users } from "@/db"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import {
  getTenantChildTeamIds,
  getChildTeamNameMap,
  getChildMemberUserIds,
} from "@/lib/tenant-scope"
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

function formatDate(value: Date | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function humanizeAction(action: string): string {
  return action
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export default async function TenantNotificationsPage() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) redirect("/dashboard")

  const [childIds, teamNames, memberIds] = await Promise.all([
    getTenantChildTeamIds(admin.tenantTeamId),
    getChildTeamNameMap(admin.tenantTeamId),
    getChildMemberUserIds(admin.tenantTeamId),
  ])

  const scopeFilters = [
    childIds.length ? inArray(auditLogs.teamId, childIds) : undefined,
    memberIds.length ? inArray(auditLogs.userId, memberIds) : undefined,
  ].filter(Boolean)

  const rows = scopeFilters.length
    ? await db
        .select({
          id: auditLogs.id,
          userId: auditLogs.userId,
          teamId: auditLogs.teamId,
          action: auditLogs.action,
          targetId: auditLogs.targetId,
          targetLabel: auditLogs.targetLabel,
          createdAt: auditLogs.createdAt,
          actorEmail: users.email,
          actorName: users.name,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.userId))
        .where(or(...scopeFilters))
        .orderBy(desc(auditLogs.createdAt))
        .limit(100)
    : []

  // eslint-disable-next-line react-hooks/purity
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const recentCount = scopeFilters.length
    ? Number(
        (
          await db
            .select({ n: sql<number>`count(*)` })
            .from(auditLogs)
            .where(and(or(...scopeFilters), gte(auditLogs.createdAt, sevenDaysAgo)))
        )[0]?.n ?? 0,
      )
    : 0
  const activeCustomers = new Set(
    rows
      .map((r) => r.teamId)
      .filter((id): id is string => Boolean(id) && teamNames.has(id!)),
  ).size

  return (
    <PageContainer>
      <PageHeader
        title="Notifications"
        description="Activity across your end-customers' teams — deploys, changes, and account events. Read-only feed."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <StatCard label="Events (last 7 days)" value={recentCount} />
        <StatCard label="Active customers" value={activeCustomers} />
      </div>

      <PageSection title="Recent Activity">
        {rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No activity yet</EmptyTitle>
              <EmptyDescription>
                Events from your end-customers&apos; teams will appear here as they happen.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Card className="overflow-hidden p-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Customer / User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const customer = row.teamId
                      ? teamNames.get(row.teamId)
                      : undefined
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="text-muted-foreground">
                          {formatDate(row.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-foreground">
                            {customer ?? row.actorName ?? row.actorEmail ?? "—"}
                          </div>
                          {row.actorEmail && (
                            <div className="text-xs text-muted-foreground">
                              {row.actorEmail}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-foreground">
                          {humanizeAction(row.action)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.targetLabel ?? row.targetId ?? "—"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </PageSection>
    </PageContainer>
  )
}
