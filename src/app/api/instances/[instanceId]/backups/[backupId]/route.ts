import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, instances, backupRecords, eq, and } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { logAuditEvent } from "@/lib/audit"
import { driveErrorResponse } from "@/lib/drive-errors"
import { getDriveAccessTokenForTeam, deleteBackup } from "@/lib/google-drive"

/**
 * DELETE /api/instances/[instanceId]/backups/[backupId]
 *
 * Removes the backup file from the user's Drive (404 tolerated) and drops the
 * local index row.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string; backupId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { instanceId, backupId } = await params
  const isAdmin = (session.user as { role?: string }).role === "admin"
  const instance = await db.query.instances.findFirst({
    where: isAdmin
      ? eq(instances.id, instanceId)
      : whereUserInstanceVisible(session.user.id, instanceId),
  })
  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  // Deleting a backup is an operation — requires Operator+ on this agent.
  if (!isAdmin && !(await canOperateInstance(session.user.id, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const record = await db.query.backupRecords.findFirst({
    where: and(eq(backupRecords.id, backupId), eq(backupRecords.instanceId, instance.id)),
  })
  if (!record) {
    return NextResponse.json({ error: "Backup not found" }, { status: 404 })
  }

  try {
    const accessToken = await getDriveAccessTokenForTeam(instance.teamId)
    await deleteBackup(accessToken, record.driveFileId)
  } catch (err) {
    const mapped = driveErrorResponse(err)
    if (mapped) return mapped
    console.error(`[backup] delete failed for ${backupId}:`, err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Could not delete backup from Drive." }, { status: 500 })
  }

  await db.delete(backupRecords).where(eq(backupRecords.id, backupId))

  await logAuditEvent({
    userId: session.user.id,
    teamId: instance.teamId,
    action: "instance.backup.delete",
    targetType: "instance",
    targetId: instance.id,
    targetLabel: instance.name,
    meta: { backupId, fileName: record.fileName },
  })

  return NextResponse.json({ success: true })
}
