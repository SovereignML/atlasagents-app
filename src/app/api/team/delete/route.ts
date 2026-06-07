import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { deleteTeam, getUserTeam, listUserTeams, switchTeam } from "@/lib/team"
import { logAuditEvent } from "@/lib/audit"

const deleteSchema = z.object({ teamId: z.string().min(1) })

// Maps the typed errors thrown by deleteTeam to user-facing responses.
const ERROR_RESPONSES: Record<string, { status: number; error: string }> = {
  NOT_FOUND: { status: 404, error: "Team not found." },
  FORBIDDEN: { status: 403, error: "Only the team owner can delete this team." },
  LAST_TEAM: { status: 409, error: "You can't delete your only team." },
  HAS_AGENTS: {
    status: 409,
    error: "Delete or move this team's agents before deleting the team.",
  },
  HAS_CHILDREN: {
    status: 409,
    error: "This team has customer organizations and can't be deleted.",
  },
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }
  const { teamId } = parsed.data
  const userId = session.user.id

  // Capture the user's active context before deleting so we know whether to
  // move them off the team that's about to disappear.
  const activeBefore = (await getUserTeam(userId))?.teamId

  let name: string
  try {
    name = await deleteTeam(userId, teamId)
  } catch (err) {
    const mapped = err instanceof Error ? ERROR_RESPONSES[err.message] : undefined
    if (mapped) {
      return NextResponse.json({ error: mapped.error }, { status: mapped.status })
    }
    throw err
  }

  // If the deleted team was active, switch the user to another team they belong
  // to so the UI doesn't point at a dead context.
  let fallbackTeamId: string | undefined
  if (activeBefore === teamId) {
    const remaining = (await listUserTeams(userId)).filter((t) => t.teamId !== teamId)
    fallbackTeamId = remaining[0]?.teamId
    if (fallbackTeamId) await switchTeam(userId, fallbackTeamId)
  } else {
    fallbackTeamId = activeBefore
  }

  await logAuditEvent({
    userId,
    action: "team.delete",
    // Record under the surviving team, not the deleted one, so the audit row
    // itself isn't residue.
    teamId: fallbackTeamId ?? null,
    targetType: "team",
    targetId: teamId,
    targetLabel: name,
  })

  return NextResponse.json({ ok: true })
}
