import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, instances, instanceLogs, backupRecords, eq } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import { logAuditEvent } from "@/lib/audit"
import { driveErrorResponse } from "@/lib/drive-errors"
import {
  getDriveAccessTokenForTeam,
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
  // Creating a backup is an operation — requires Operator+ on this agent.
  if (!isAdmin && !(await canOperateInstance(session.user.id, instance.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!instance.agentConfig) {
    return NextResponse.json({ error: "Nothing to back up yet." }, { status: 400 })
  }

  try {
    // Backups go to the team's shared Drive connection.
    const accessToken = await getDriveAccessTokenForTeam(instance.teamId)
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
        teamId: instance.teamId,
        userId: session.user.id,
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
      teamId: instance.teamId,
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
    console.error(`[backup] failed for ${instanceId}:`, err)
    // Drive REST errors carry a readable, actionable message (e.g. "Google
    // Drive upload 403: Google Drive API has not been used in project …").
    // Surface it so the operator can act without server-log access — these are
    // safe to show since the backup goes to the user's own Drive.
    const detail =
      err instanceof Error && err.message.startsWith("Google Drive ") ? err.message : undefined
    return NextResponse.json(
      { error: "Backup failed. Please try again.", ...(detail ? { detail } : {}) },
      { status: 500 },
    )
  }
}
