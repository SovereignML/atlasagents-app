import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, and, isNull, sql, teamInvites, memberships, teams, users } from "@/db"
import { z } from "zod"
import { logAuditEvent } from "@/lib/audit"

const acceptSchema = z.object({ token: z.string().min(1) })

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = acceptSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }

  const invite = await db.query.teamInvites.findFirst({
    where: and(
      eq(teamInvites.token, parsed.data.token),
      isNull(teamInvites.acceptedAt),
      isNull(teamInvites.revokedAt),
    ),
  })

  if (!invite) {
    return NextResponse.json({ error: "Invite not found or already used" }, { status: 404 })
  }
  if (invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 410 })
  }

  const me = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { email: true },
  })
  if (!me?.email || me.email.toLowerCase() !== invite.email.toLowerCase()) {
    return NextResponse.json(
      { error: `Sign in as ${invite.email} to accept this invite.` },
      { status: 403 },
    )
  }

  const team = await db.query.teams.findFirst({
    where: eq(teams.id, invite.teamId),
  })
  if (!team) {
    return NextResponse.json({ error: "Team no longer exists" }, { status: 404 })
  }

  try {
    await db.transaction(async (tx) => {
      // Serialize concurrent acceptances against the team row so the
      // seat-limit check + insert is atomic. Without this lock, two
      // simultaneous accepts on a near-full team can both pass the
      // count check and overshoot the limit.
      await tx.execute(sql`SELECT 1 FROM "Team" WHERE id = ${team.id} FOR UPDATE`)
      const current = await tx.query.memberships.findMany({
        where: eq(memberships.teamId, team.id),
      })
      if (current.length >= team.seatLimit) {
        throw new Error("SEAT_LIMIT")
      }
      await tx
        .insert(memberships)
        .values({ teamId: team.id, userId: session.user!.id!, role: invite.role })
        .onConflictDoNothing()
      await tx
        .update(teamInvites)
        .set({ acceptedAt: new Date() })
        .where(eq(teamInvites.id, invite.id))
    })
  } catch (err) {
    if (err instanceof Error && err.message === "SEAT_LIMIT") {
      return NextResponse.json({ error: "Team is at seat limit" }, { status: 409 })
    }
    throw err
  }

  await logAuditEvent({
    userId: session.user.id,
    action: "team.accept",
    teamId: team.id,
    targetType: "team",
    targetId: team.id,
    targetLabel: team.name,
  })

  return NextResponse.json({ ok: true, teamId: team.id, teamName: team.name })
}
