import { NextRequest, NextResponse } from "next/server"

import { db, databaseBackups, eq } from "@/db"
import { requireAdmin } from "@/lib/admin-guard"
import { restoreDatabaseFromBackup } from "@/lib/db-backup"
import { r2ErrorResponse } from "@/lib/r2-errors"

export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * POST /api/admin/backups/[id]/restore — DESTRUCTIVE. Restores the whole DB from
 * an R2 backup via `pg_restore --clean`, overwriting all live data. Requires an
 * exact `{ confirm: "RESTORE" }` body. Admin session only — never cron.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const body = await req.json().catch(() => ({}))
  if (body?.confirm !== "RESTORE") {
    return NextResponse.json(
      { error: 'Type "RESTORE" to confirm this destructive action.' },
      { status: 400 },
    )
  }

  const { id } = await params
  const row = await db.query.databaseBackups.findFirst({
    where: eq(databaseBackups.id, id),
  })
  if (!row) return NextResponse.json({ error: "Backup not found" }, { status: 404 })
  if (row.status !== "success") {
    return NextResponse.json({ error: "Cannot restore from an incomplete backup." }, { status: 400 })
  }

  try {
    const result = await restoreDatabaseFromBackup({ key: row.objectKey, userId: guard.userId })
    return NextResponse.json({ success: true, warnings: result.warnings })
  } catch (err) {
    const mapped = r2ErrorResponse(err)
    if (mapped) return mapped
    console.error(
      `[admin/backups] restore failed for ${row.objectKey}:`,
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Restore failed." },
      { status: 500 },
    )
  }
}
