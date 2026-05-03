import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { db, eq, and, isNull, memberships, teamInvites, teams, users } from "@/db"
import { getUserTeam, listUserTeams, type TeamRole } from "@/lib/team"
import { TeamClient } from "./team-client"

export const dynamic = "force-dynamic"

export default async function TeamPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const userId = session.user.id

  const ctx = await getUserTeam(userId)
  if (!ctx) redirect("/dashboard")
  const activeTeamId = ctx.teamId

  const team = await db.query.teams.findFirst({
    where: eq(teams.id, activeTeamId),
  })
  if (!team) redirect("/dashboard")

  const myRole: TeamRole = ctx.role

  const memberRows = await db.query.memberships.findMany({
    where: eq(memberships.teamId, team.id),
    with: { user: { columns: { id: true, name: true, email: true } } },
  })

  const invites = await db.query.teamInvites.findMany({
    where: and(
      eq(teamInvites.teamId, team.id),
      isNull(teamInvites.acceptedAt),
      isNull(teamInvites.revokedAt),
    ),
  })

  const members = memberRows
    .map((m) => ({
      userId: m.userId,
      role: m.role as TeamRole,
      name: m.user?.name ?? null,
      email: m.user?.email ?? "",
    }))
    .sort((a, b) => {
      const order = { owner: 0, admin: 1, developer: 2, viewer: 3 } as const
      return order[a.role] - order[b.role]
    })

  const allTeams = await listUserTeams(userId)

  void users

  return (
    <TeamClient
      team={{ id: team.id, name: team.name, seatLimit: team.seatLimit }}
      myRole={myRole}
      members={members}
      invites={invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role as TeamRole,
        expiresAt: i.expiresAt.toISOString(),
      }))}
      allTeams={allTeams.map((t) => ({ teamId: t.teamId, name: t.name, role: t.role }))}
      activeTeamId={activeTeamId}
    />
  )
}
