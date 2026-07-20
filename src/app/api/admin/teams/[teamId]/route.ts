import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/auth"
import { db, teams, eq } from "@/db"
import { logAuditEvent } from "@/lib/audit"

const schema = z.object({
  whiteLabelEnabled: z.boolean(),
})

/**
 * PATCH /api/admin/teams/[teamId]
 *
 * Platform-admin white-label toggle. `Team.whiteLabelEnabled` is the sole source
 * of truth for white-label entitlement (branding, custom domains, reseller
 * panel), so flipping it here grants or revokes the feature for the team live.
 * Recorded in the audit log.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { teamId } = await params
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const { whiteLabelEnabled } = parsed.data

  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    columns: { id: true, name: true },
  })
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 })
  }

  await db
    .update(teams)
    .set({ whiteLabelEnabled })
    .where(eq(teams.id, teamId))

  await logAuditEvent({
    userId: session.user.id,
    action: "admin.whitelabel_toggle",
    targetType: "team",
    targetId: team.id,
    targetLabel: team.name,
    meta: { whiteLabelEnabled },
  })

  return NextResponse.json({ ok: true, id: team.id, whiteLabelEnabled })
}
