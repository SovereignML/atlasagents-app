import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, and, memberships } from "@/db"
import { z } from "zod"
import { getUserTeam, canManageTeam, canAssignRole, type TeamRole } from "@/lib/team"

const patchSchema = z.object({ role: z.enum(["admin", "developer", "viewer"]) })

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const ctx = await getUserTeam(session.user.id)
  if (!ctx || !canManageTeam(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { userId: targetId } = await params
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }

  const target = await db.query.memberships.findFirst({
    where: and(eq(memberships.teamId, ctx.teamId), eq(memberships.userId, targetId)),
  })
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (target.role === "owner") {
    return NextResponse.json({ error: "Cannot change owner role" }, { status: 400 })
  }
  if (!canAssignRole(ctx.role, parsed.data.role as TeamRole)) {
    return NextResponse.json({ error: "Cannot assign that role" }, { status: 403 })
  }

  await db
    .update(memberships)
    .set({ role: parsed.data.role })
    .where(and(eq(memberships.teamId, ctx.teamId), eq(memberships.userId, targetId)))

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const ctx = await getUserTeam(session.user.id)
  if (!ctx || !canManageTeam(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { userId: targetId } = await params

  const target = await db.query.memberships.findFirst({
    where: and(eq(memberships.teamId, ctx.teamId), eq(memberships.userId, targetId)),
  })
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (target.role === "owner") {
    return NextResponse.json({ error: "Cannot remove the team owner" }, { status: 400 })
  }
  // Admins cannot remove other admins.
  if (ctx.role === "admin" && target.role === "admin") {
    return NextResponse.json({ error: "Admins cannot remove other admins" }, { status: 403 })
  }

  await db
    .delete(memberships)
    .where(and(eq(memberships.teamId, ctx.teamId), eq(memberships.userId, targetId)))

  return NextResponse.json({ ok: true })
}
