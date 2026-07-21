import { redirect } from "next/navigation"

import { db, inArray, desc, eq, backupRecords, instances } from "@/db"
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

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—"
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

export default async function TenantBackupsPage() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) redirect("/dashboard")

  const [childIds, teamNames] = await Promise.all([
    getTenantChildTeamIds(admin.tenantTeamId),
    getChildTeamNameMap(admin.tenantTeamId),
  ])

  const rows = childIds.length
    ? await db
        .select({
          id: backupRecords.id,
          agentName: backupRecords.agentName,
          instanceName: instances.name,
          instanceId: backupRecords.instanceId,
          teamId: backupRecords.teamId,
          fileName: backupRecords.fileName,
          sizeBytes: backupRecords.sizeBytes,
          createdAt: backupRecords.createdAt,
        })
        .from(backupRecords)
        .leftJoin(instances, eq(instances.id, backupRecords.instanceId))
        .where(inArray(backupRecords.teamId, childIds))
        .orderBy(desc(backupRecords.createdAt))
        .limit(100)
    : []

  const agentsWithBackups = new Set(
    rows.map((r) => r.instanceId ?? r.agentName),
  ).size

  return (
    <PageContainer>
      <PageHeader
        title="Backups"
        description="Backups taken across your end-customers' agents. Read-only overview — creating or restoring a backup is done from an agent via “Manage as customer”."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <StatCard label="Total backups" value={rows.length} />
        <StatCard label="Agents with backups" value={agentsWithBackups} />
      </div>

      <PageSection title="Recent Backups">
        {childIds.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No customers yet</EmptyTitle>
              <EmptyDescription>
                Backups from your end-customers&apos; agents will appear here once you have customers.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No backups yet</EmptyTitle>
              <EmptyDescription>
                None of your customers&apos; agents have been backed up yet.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Card className="overflow-hidden p-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Size</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium text-foreground">
                        {row.instanceName ?? row.agentName}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {teamNames.get(row.teamId) ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(row.createdAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatSize(row.sizeBytes)}
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
