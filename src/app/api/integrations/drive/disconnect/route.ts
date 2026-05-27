import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, driveConnections, eq } from "@/db"
import { logAuditEvent } from "@/lib/audit"
import { decryptSecret } from "@/lib/crypto-secret"
import { revokeDriveToken } from "@/lib/google-drive"

/**
 * POST /api/integrations/drive/disconnect
 *
 * Revokes the Google Drive grant (best-effort) and removes the stored
 * connection. Existing backup files remain in the user's Drive and become
 * usable again if they reconnect.
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const conn = await db.query.driveConnections.findFirst({
    where: eq(driveConnections.userId, session.user.id),
  })
  if (!conn) {
    return NextResponse.json({ success: true })
  }

  try {
    await revokeDriveToken(decryptSecret(conn.refreshTokenEnc))
  } catch {
    // best-effort revoke; ignore
  }

  await db.delete(driveConnections).where(eq(driveConnections.userId, session.user.id))

  await logAuditEvent({
    userId: session.user.id,
    action: "drive.disconnect",
    targetType: "drive_connection",
    targetLabel: conn.googleEmail ?? undefined,
  })

  return NextResponse.json({ success: true })
}
