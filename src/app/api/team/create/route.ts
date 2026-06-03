import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { createTeam, switchTeam } from "@/lib/team"
import { logAuditEvent } from "@/lib/audit"

const createSchema = z.object({ name: z.string().trim().min(1).max(50) })

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }

  const isAdmin = (session.user as { role?: string }).role === "admin"

  let team
  try {
    team = await createTeam(session.user.id, parsed.data.name, { bypassLimit: isAdmin })
  } catch (err) {
    if (err instanceof Error && err.message === "TEAM_LIMIT") {
      return NextResponse.json(
        { error: "You've reached the maximum of 5 teams." },
        { status: 409 },
      )
    }
    throw err
  }
  // Make the new team the user's active context so the UI switches to it.
  await switchTeam(session.user.id, team.id)
  await logAuditEvent({
    userId: session.user.id,
    action: "team.create",
    teamId: team.id,
    targetType: "team",
    targetId: team.id,
    targetLabel: team.name,
  })

  return NextResponse.json({ ok: true, teamId: team.id })
}
