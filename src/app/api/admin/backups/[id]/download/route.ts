import { NextRequest, NextResponse } from "next/server"

import { db, databaseBackups, eq } from "@/db"
import { requireAdmin } from "@/lib/admin-guard"
import { getR2Config, presignDownload } from "@/lib/r2"
import { r2ErrorResponse } from "@/lib/r2-errors"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/backups/[id]/download — returns a short-lived presigned URL so
 * the browser pulls the dump straight from R2 (no proxying through the app).
 */
export async function GET(
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
    const url = await presignDownload(cfg, row.objectKey, 300)
    return NextResponse.json({ url, fileName: row.fileName })
  } catch (err) {
    const mapped = r2ErrorResponse(err)
    if (mapped) return mapped
    console.error(
      `[admin/backups] presign failed for ${row.objectKey}:`,
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json({ error: "Could not create download link." }, { status: 500 })
  }
}
