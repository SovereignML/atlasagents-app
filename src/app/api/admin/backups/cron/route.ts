import { NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"
import { isValidCronBearer } from "@/lib/cron-auth"
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
  const isCron = isValidCronBearer(req, process.env.BACKUP_CRON_TOKEN)

  let userId: string | null = null
  if (!isCron) {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    userId = session.user.id
  }

  try {
    const result = await runDatabaseBackup({ trigger: "scheduled", userId })
    return NextResponse.json({ success: true, backup: result })
  } catch (err) {
    const mapped = r2ErrorResponse(err)
    if (mapped) return mapped
    console.error("[admin/backups/cron] backup failed:", err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backup failed." },
      { status: 500 },
    )
  }
}
