import Link from "next/link"
import { redirect } from "next/navigation"
import { Download } from "lucide-react"

import { auth } from "@/auth"
import { db, auditLogs, eq, desc, and, like } from "@/db"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PageContainer, PageHeader, PageSection } from "@/components/layout/page-container"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getEffectiveUserId } from "@/lib/effective-user"

const ACTION_PILL_BASE =
  "inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] border"

// Color a pill by the action string. Deploy-family actions are green,
// billing/topup actions are lime (primary), everything else is neutral.
function actionPillClass(action: string): string {
  if (action.startsWith("deploy") || action.includes(".deploy")) {
    return "bg-emerald-500/12 text-emerald-500 border-emerald-500/28"
  }
  if (action.startsWith("billing") || action.startsWith("topup")) {
    return "bg-primary/12 text-primary border-primary/30"
  }
  return "bg-muted text-muted-foreground border-border"
}

const FILTERS = [
  { label: "All", value: "" },
  { label: "Instances", value: "instance" },
  { label: "Team", value: "team" },
  { label: "Billing", value: "billing" },
  { label: "Account", value: "account" },
  { label: "Admin", value: "admin" },
]

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
  const params = await searchParams
  const filter = params.filter || ""
  const page = Math.max(Number(params.page || "1"), 1)
  const pageSize = 50

  const conditions = [eq(auditLogs.userId, effectiveUserId)]
  if (filter) {
    conditions.push(like(auditLogs.action, `${filter}%`))
  }

  const events = await db.query.auditLogs.findMany({
    where: and(...conditions),
    orderBy: [desc(auditLogs.createdAt)],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  })

  return (
    <PageContainer>
      <PageHeader
        title="Audit Log"
        description="Every action taken on your account. Retained for 7 days."
      />

      <PageSection
        title="Activity"
        description="Filter events by category or export the full log."
        actions={
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 rounded-[10px] border-border bg-secondary"
            render={
              <a href="/api/audit-log/export">
                <Download className="size-3.5" />
                Export
              </a>
            }
          />
        }
      >
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filter === f.value ? "default" : "outline"}
              className="rounded-full"
              render={
                <Link
                  href={f.value ? `/dashboard/audit-log?filter=${f.value}` : "/dashboard/audit-log"}
                >
                  {f.label}
                </Link>
              }
            />
          ))}
        </div>

        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-sidebar hover:bg-sidebar">
                <TableHead className="pl-5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  Time
                </TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  Action
                </TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  Target
                </TableHead>
                <TableHead className="pr-5 text-right font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  IP
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-12 text-center text-sm text-muted-foreground">
                    No audit events recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="pl-5 font-mono text-xs text-muted-foreground">
                      {e.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                    </TableCell>
                    <TableCell>
                      <span className={`${ACTION_PILL_BASE} ${actionPillClass(e.action)}`}>
                        {e.action}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground">
                      {e.targetLabel || e.targetId || "-"}
                    </TableCell>
                    <TableCell className="pr-5 text-right font-mono text-xs text-muted-foreground">
                      {e.ipAddress || "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>

        {events.length >= pageSize && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              render={
                <Link
                  href={`/dashboard/audit-log?${filter ? `filter=${filter}&` : ""}page=${page + 1}`}
                >
                  Next Page
                </Link>
              }
            />
          </div>
        )}
      </PageSection>
    </PageContainer>
  )
}
