import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, instances, backupRecords, eq, and, desc } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { driveErrorResponse } from "@/lib/drive-errors"
import { getDriveAccessTokenForUser, listBackups } from "@/lib/google-drive"
import { BACKUP_SCHEMA_VERSION } from "@/lib/agent-backup"

/**
 * GET /api/instances/[instanceId]/backups[?source=drive]
 *
 * Lists this agent's backups from the local index (fast path). With
 * `?source=drive`, reconciles against the user's Drive: imports any backup
 * files missing from the index. Never hard-fails on a single missing file.
 */
export async function GET(
  req: NextRequest,
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

  if (req.nextUrl.searchParams.get("source") === "drive") {
    try {
      const accessToken = await getDriveAccessTokenForUser(instance.userId)
      const files = await listBackups(accessToken, instance.id)
      const known = await db.query.backupRecords.findMany({
        where: eq(backupRecords.instanceId, instance.id),
        columns: { driveFileId: true },
      })
      const knownIds = new Set(known.map((r) => r.driveFileId))
      for (const f of files) {
        if (knownIds.has(f.id)) continue
        await db
          .insert(backupRecords)
          .values({
            userId: instance.userId,
            instanceId: instance.id,
            driveFileId: f.id,
            fileName: f.name,
            agentName: f.appProperties?.agentName ?? instance.name,
            schemaVersion: Number(f.appProperties?.schemaVersion ?? BACKUP_SCHEMA_VERSION),
            sizeBytes: f.size ? Number(f.size) : null,
            ...(f.createdTime ? { createdAt: new Date(f.createdTime) } : {}),
          })
          .onConflictDoNothing()
      }
    } catch (err) {
      const mapped = driveErrorResponse(err)
      if (mapped) return mapped
      console.error(`[backups] drive reconcile failed for ${instanceId}:`, err)
      // fall through to return whatever is in the local index
    }
  }

  const rows = await db.query.backupRecords.findMany({
    where: and(eq(backupRecords.instanceId, instance.id)),
    orderBy: desc(backupRecords.createdAt),
  })

  return NextResponse.json({
    backups: rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      agentName: r.agentName,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt,
    })),
  })
}
