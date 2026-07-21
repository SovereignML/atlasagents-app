import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, sshKeys, eq, and } from "@/db"
import { requireTeamManage } from "@/lib/team"
import { logAuditEvent } from "@/lib/audit"
import { syncTeamSshKeys } from "@/lib/provisioner"

/**
 * DELETE /api/team/ssh-keys/[keyId]
 *
 * Remove a shared SSH key from the active team. Owners/admins only. The key is
 * reconciled off the team's running managed-VPS agents (best-effort), revoking
 * that key's root SSH access on each box.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ keyId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const team = await requireTeamManage(session.user.id)
  if (!team) {
    return NextResponse.json(
      { error: "Only team owners and admins can remove SSH keys" },
      { status: 403 },
    )
  }

  const { keyId } = await params
  const key = await db.query.sshKeys.findFirst({
    where: and(eq(sshKeys.id, keyId), eq(sshKeys.teamId, team.teamId)),
  })
  if (!key) {
    return NextResponse.json({ error: "SSH key not found" }, { status: 404 })
  }

  await db.delete(sshKeys).where(eq(sshKeys.id, keyId))

  await logAuditEvent({
    userId: session.user.id,
    teamId: team.teamId,
    action: "team.ssh_key.remove",
    targetType: "ssh_key",
    targetId: keyId,
    targetLabel: key.name,
  })

  // Revoke the key from the team's running managed-VPS agents. Best-effort and
  // non-blocking — the row is already gone; a re-provision reconciles any box
  // missed here.
  void syncTeamSshKeys(team.teamId).catch(() => {})

  return NextResponse.json({ success: true })
}
