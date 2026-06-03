import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { db } from "@/db"
import { listBackups } from "@/lib/db-backup"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { BackupsClient } from "./backups-client"

export const dynamic = "force-dynamic"

export default async function AdminBackupsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  if ((session.user as { role?: string }).role !== "admin") redirect("/dashboard")

  const [row, backups] = await Promise.all([
    db.query.r2BackupConfig.findFirst(),
    listBackups(),
  ])

  const rows = backups.map((b) => ({
    ...b,
    startedAt: b.startedAt?.toISOString() ?? null,
    completedAt: b.completedAt?.toISOString() ?? null,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Admin · Backups"
        description="Full-database snapshots (pg_dump) stored in Cloudflare R2. Back up on demand or nightly, download a dump, or restore the whole database from one. This captures all app data — users, teams, instances, billing, audit logs, and branding."
      />
      <BackupsClient
        initialSettings={{
          configured: !!row,
          accountId: row?.accountId ?? "",
          bucket: row?.bucket ?? "",
          endpoint: row?.endpoint ?? "",
          retentionCount: row?.retentionCount ?? 14,
        }}
        initialBackups={rows}
      />
    </PageContainer>
  )
}
