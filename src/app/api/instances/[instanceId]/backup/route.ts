import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, instances, instanceLogs, backupRecords, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { logAuditEvent } from "@/lib/audit"
import { driveErrorResponse } from "@/lib/drive-errors"
import {
  getDriveAccessTokenForUser,
  uploadBackup,
  BACKUP_TAG,
} from "@/lib/google-drive"
import {
  serializeAgentBackup,
  backupFileName,
  BACKUP_SCHEMA_VERSION,
} from "@/lib/agent-backup"

/**
 * POST /api/instances/[instanceId]/backup
 *
 * Snapshot the agent's settings (no secrets) and upload it to the user's
 * Google Drive, recording a local index row.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { instanceId } = await params
  const isAdmin = (session.user as { role?: string }).role === "admin"
  const instance = await db.query.instances.findFirst({
    where: isAdmin
      ? eq(instances.id, instanceId)
      : whereUserInstanceVisible(session.user.id, instanceId),
  })
  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 })
  }
  if (!isAdmin && instance.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!instance.agentConfig) {
    return NextResponse.json({ error: "Nothing to back up yet." }, { status: 400 })
  }

  // Backups are stored in the connected user's own Drive (the owner's), not the
  // admin's. Resolve the token for the instance owner.
  const ownerId = instance.userId

  try {
    const accessToken = await getDriveAccessTokenForUser(ownerId)
    const envelope = serializeAgentBackup(instance)
    const fileName = backupFileName(instance.name)

    const { fileId, size } = await uploadBackup(accessToken, {
      fileName,
      json: JSON.stringify(envelope, null, 2),
      appProperties: {
        tag: BACKUP_TAG,
        instanceId: instance.id,
        agentName: instance.name,
        schemaVersion: String(BACKUP_SCHEMA_VERSION),
      },
    })

    const [record] = await db
      .insert(backupRecords)
      .values({
        userId: ownerId,
        instanceId: instance.id,
        driveFileId: fileId,
        fileName,
        agentName: instance.name,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        sizeBytes: size || null,
      })
      .returning()

    await db.insert(instanceLogs).values({
      instanceId: instance.id,
      level: "info",
      message: `Backup created to Google Drive: ${fileName}`,
    })
    await logAuditEvent({
      userId: session.user.id,
      action: "instance.backup.create",
      targetType: "instance",
      targetId: instance.id,
      targetLabel: instance.name,
      meta: { fileName, driveFileId: fileId },
    })

    return NextResponse.json({
      success: true,
      backup: {
        id: record.id,
        fileName: record.fileName,
        agentName: record.agentName,
        sizeBytes: record.sizeBytes,
        createdAt: record.createdAt,
      },
    })
  } catch (err) {
    const mapped = driveErrorResponse(err)
    if (mapped) return mapped
    console.error(`[backup] failed for ${instanceId}:`, err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Backup failed. Please try again." }, { status: 500 })
  }
}
