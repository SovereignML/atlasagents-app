import { NextRequest, NextResponse } from "next/server"
import { apiError } from "@/lib/api-error"

import { requireAdminOrCron } from "@/lib/admin-guard"
import { runDatabaseBackup } from "@/lib/db-backup"
import { r2ErrorResponse } from "@/lib/r2-errors"

export const dynamic = "force-dynamic"
// Full pg_dump + upload — give it room. Suggested cadence: nightly.
export const maxDuration = 300

/**
 * POST /api/admin/backups/cron
 *
 * Scheduled full-database backup → R2. Authorize one of two ways:
 *   1. Bearer token matching BACKUP_CRON_TOKEN (for the scheduler).
 *   2. An admin-role session (manual trigger from the panel).
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req, process.env.BACKUP_CRON_TOKEN)
  if (!guard.ok) return guard.res
  const userId = guard.userId

  try {
    const result = await runDatabaseBackup({ trigger: "scheduled", userId })
    return NextResponse.json({ success: true, backup: result })
  } catch (err) {
    const mapped = r2ErrorResponse(err)
    if (mapped) return mapped
    return apiError("admin/backups/cron", err, "Backup failed.")
  }
}
