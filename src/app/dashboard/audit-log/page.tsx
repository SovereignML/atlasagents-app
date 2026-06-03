import Link from "next/link"
import { redirect } from "next/navigation"

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

const ACTION_STYLES: Record<string, string> = {
  "instance.deploy": "text-primary",
  "instance.delete": "text-destructive",
  "instance.restart": "text-amber-500",
  "instance.stop": "text-amber-500",
  "team.invite": "text-primary",
  "team.accept": "text-primary",
  "team.member_remove": "text-destructive",
  "team.role_change": "text-amber-500",
  "team.switch": "text-muted-foreground",
  "account.login": "text-muted-foreground",
  "account.password_change": "text-amber-500",
  "account.profile_update": "text-muted-foreground",
  "billing.subscription.create": "text-primary",
  "billing.subscription.cancel": "text-destructive",
  "admin.impersonate": "text-amber-500",
  "admin.ban": "text-destructive",
  "admin.unban": "text-primary",
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
            render={<a href="/api/audit-log/export">Download CSV</a>}
          />
        }
      >
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filter === f.value ? "default" : "outline"}
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
              <TableRow>
                <TableHead className="pl-5">Time</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="pr-5 text-right">IP</TableHead>
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
                    <TableCell
                      className={`font-mono text-xs ${ACTION_STYLES[e.action] || "text-foreground"}`}
                    >
                      {e.action}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground">
                      {e.targetLabel || e.targetId || "—"}
                    </TableCell>
                    <TableCell className="pr-5 text-right font-mono text-xs text-muted-foreground">
                      {e.ipAddress || "—"}
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
