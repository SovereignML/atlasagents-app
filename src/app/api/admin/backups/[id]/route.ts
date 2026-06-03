import { NextRequest, NextResponse } from "next/server"

import { db, databaseBackups, eq } from "@/db"
import { requireAdmin } from "@/lib/admin-guard"
import { logAuditEvent } from "@/lib/audit"
import { getR2Config, deleteR2Object } from "@/lib/r2"
import { r2ErrorResponse } from "@/lib/r2-errors"

export const dynamic = "force-dynamic"

/** DELETE /api/admin/backups/[id] — remove the R2 object and its record. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const { id } = await params
  const row = await db.query.databaseBackups.findFirst({
    where: eq(databaseBackups.id, id),
  })
  if (!row) return NextResponse.json({ error: "Backup not found" }, { status: 404 })

  try {
    const cfg = await getR2Config()
    await deleteR2Object(cfg, row.objectKey)
  } catch (err) {
    const mapped = r2ErrorResponse(err)
    if (mapped) return mapped
    // If the object is already gone, fall through and still drop the row.
    console.error(
      `[admin/backups] R2 delete failed for ${row.objectKey}:`,
      err instanceof Error ? err.message : err,
    )
  }

  await db.delete(databaseBackups).where(eq(databaseBackups.id, id))

  await logAuditEvent({
    userId: guard.userId,
    action: "admin.backup.delete",
    targetType: "database_backup",
    targetId: id,
    targetLabel: row.fileName,
  })

  return NextResponse.json({ success: true })
}
