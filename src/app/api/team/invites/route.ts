import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, and, isNull, teamInvites, memberships, teams, users } from "@/db"
import { z } from "zod"
import { randomBytes } from "node:crypto"
import { getUserTeam, canManageTeam, canAssignRole } from "@/lib/team"
import { getTeamSeatLimit } from "@/lib/seats"
import { sendTeamInviteEmail } from "@/lib/email"
import { logAuditEvent } from "@/lib/audit"

const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "developer", "viewer"]),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const ctx = await getUserTeam(userId)
  if (!ctx || !canManageTeam(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = createInviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  if (!canAssignRole(ctx.role, parsed.data.role)) {
    return NextResponse.json({ error: "Cannot assign that role" }, { status: 403 })
  }

  const team = await db.query.teams.findFirst({ where: eq(teams.id, ctx.teamId) })
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 })

  // Reject when the team is already at its seat limit. Mirrors the UI's
  // `seatsUsed` (members + open invites) and the accept-time cap so the limit
  // doesn't depend on the client. Platform staff bypass.
  const isAdmin = (session.user as { role?: string }).role === "admin"
  if (!isAdmin) {
    const [memberCount, openInvites, seatLimit] = await Promise.all([
      db.query.memberships.findMany({ where: eq(memberships.teamId, team.id) }),
      db.query.teamInvites.findMany({
        where: and(
          eq(teamInvites.teamId, team.id),
          isNull(teamInvites.acceptedAt),
          isNull(teamInvites.revokedAt),
        ),
      }),
      getTeamSeatLimit(team),
    ])
    if (memberCount.length + openInvites.length >= seatLimit) {
      return NextResponse.json({ error: "Team is at seat limit" }, { status: 409 })
    }
  }

  const email = parsed.data.email.toLowerCase().trim()

  // If user already a member, reject.
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  })
  if (existingUser) {
    const m = await db.query.memberships.findFirst({
      where: and(eq(memberships.teamId, team.id), eq(memberships.userId, existingUser.id)),
    })
    if (m) {
      return NextResponse.json({ error: "User is already a member" }, { status: 409 })
    }
  }

  // Replace any open invite for the same email + team.
  await db
    .update(teamInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(teamInvites.teamId, team.id),
        eq(teamInvites.email, email),
        isNull(teamInvites.acceptedAt),
        isNull(teamInvites.revokedAt),
      ),
    )

  const token = randomBytes(24).toString("base64url")
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const [invite] = await db
    .insert(teamInvites)
    .values({
      teamId: team.id,
      email,
      role: parsed.data.role,
      token,
      invitedById: userId,
      expiresAt,
    })
    .returning()

  const inviter = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { name: true, email: true },
  })

  const emailResult = await sendTeamInviteEmail({
    email,
    token,
    teamName: team.name,
    inviterName: inviter?.name || inviter?.email || "A teammate",
    role: parsed.data.role,
  })

  await logAuditEvent({
    userId,
    action: "team.invite",
    teamId: team.id,
    targetType: "user",
    targetLabel: email,
    meta: { role: parsed.data.role },
  })

  return NextResponse.json({
    invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt },
    acceptUrl: emailResult.acceptUrl,
    emailSent: emailResult.success,
  })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const ctx = await getUserTeam(session.user.id)
  if (!ctx || !canManageTeam(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const invites = await db.query.teamInvites.findMany({
    where: and(
      eq(teamInvites.teamId, ctx.teamId),
      isNull(teamInvites.acceptedAt),
      isNull(teamInvites.revokedAt),
    ),
  })
  return NextResponse.json({ invites })
}
