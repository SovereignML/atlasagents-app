import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, and, teamInvites } from "@/db"
import { getUserTeam, canManageTeam } from "@/lib/team"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ inviteId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const ctx = await getUserTeam(session.user.id)
  if (!ctx || !canManageTeam(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { inviteId } = await params

  const invite = await db.query.teamInvites.findFirst({
    where: and(eq(teamInvites.id, inviteId), eq(teamInvites.teamId, ctx.teamId)),
  })
  if (!invite) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await db
    .update(teamInvites)
    .set({ revokedAt: new Date() })
    .where(eq(teamInvites.id, inviteId))

  return NextResponse.json({ ok: true })
}
