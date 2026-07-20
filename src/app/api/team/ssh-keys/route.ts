import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, sshKeys, eq, and, desc } from "@/db"
import { getUserTeam, requireTeamManage } from "@/lib/team"
import { computeSshFingerprint, isValidPublicKey } from "@/lib/instance"
import { logAuditEvent } from "@/lib/audit"
import { syncTeamSshKeys } from "@/lib/provisioner"

/**
 * GET /api/team/ssh-keys
 *
 * Lists the active team's shared SSH keys. Any member may view.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const team = await getUserTeam(session.user.id)
  if (!team) return NextResponse.json({ error: "No active team" }, { status: 403 })

  const rows = await db.query.sshKeys.findMany({
    where: eq(sshKeys.teamId, team.teamId),
    orderBy: desc(sshKeys.createdAt),
  })
  return NextResponse.json({
    keys: rows.map((k) => ({
      id: k.id,
      name: k.name,
      fingerprint: k.fingerprint,
      createdAt: k.createdAt,
    })),
  })
}

/**
 * POST /api/team/ssh-keys
 * Body: { name?: string, publicKey: string }
 *
 * Add a shared SSH key to the team. Owners/admins only. Deduped by fingerprint
 * within the team.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const team = await requireTeamManage(session.user.id)
  if (!team) {
    return NextResponse.json(
      { error: "Only team owners and admins can add SSH keys" },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { name?: string; publicKey?: string }
  const publicKey = body.publicKey?.trim()
  if (!publicKey || !isValidPublicKey(publicKey)) {
    return NextResponse.json({ error: "Invalid SSH public key" }, { status: 400 })
  }
  const fingerprint = computeSshFingerprint(publicKey)

  const existing = await db.query.sshKeys.findFirst({
    where: and(eq(sshKeys.fingerprint, fingerprint), eq(sshKeys.teamId, team.teamId)),
  })
  if (existing) {
    return NextResponse.json({ error: "This key is already added to the team" }, { status: 409 })
  }

  const name = body.name?.trim() || `key-${fingerprint.slice(7, 19)}`
  const [created] = await db
    .insert(sshKeys)
    .values({ teamId: team.teamId, userId: session.user.id, name, publicKey, fingerprint })
    .returning()

  await logAuditEvent({
    userId: session.user.id,
    teamId: team.teamId,
    action: "team.ssh_key.add",
    targetType: "ssh_key",
    targetId: created.id,
    targetLabel: name,
  })

  // Reconcile the key onto the team's running managed-VPS agents. Best-effort
  // and non-blocking — the key is saved regardless of box reachability, and a
  // re-provision would reconcile any box missed here.
  void syncTeamSshKeys(team.teamId).catch(() => {})

  return NextResponse.json({
    key: {
      id: created.id,
      name: created.name,
      fingerprint: created.fingerprint,
      createdAt: created.createdAt,
    },
  })
}
