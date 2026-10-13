import { NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"

import { requireAdmin } from "@/lib/admin-guard"
import { r2ErrorResponse } from "@/lib/r2-errors"
import { listBackups, runDatabaseBackup } from "@/lib/db-backup"

export const dynamic = "force-dynamic"
// Backups stream a full pg_dump to R2 — allow generous time on platforms that
// honor route segment limits.
export const maxDuration = 300

/** GET /api/admin/backups — list recorded backups (annotated with R2 presence). */
export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const backups = await listBackups()
  return NextResponse.json({ backups })
}

/** POST /api/admin/backups — take a backup now (manual trigger). */
export async function POST() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  try {
    const result = await runDatabaseBackup({ trigger: "manual", userId: guard.userId })
    return NextResponse.json({ success: true, backup: result })
  } catch (err) {
    const mapped = r2ErrorResponse(err)
    if (mapped) return mapped
    return apiError("admin/backups", err, "Backup failed.")
  }
}
