import { auth } from "@/auth"
import { redirect } from "next/navigation"
import {
  db,
  eq,
  and,
  ne,
  desc,
  isNull,
  inArray,
  instances,
  memberships,
  teamInvites,
  teams,
  subscriptions,
  driveConnections,
  cloudflareConnections,
  sshKeys,
  backupRecords,
} from "@/db"
import { getUserTeam, listUserTeams, canManageTeam, type TeamRole } from "@/lib/team"
import { getTeamSeatLimit } from "@/lib/seats"
import { isDriveConfigured } from "@/lib/google-drive"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { TeamTabs } from "./team-tabs"

export const dynamic = "force-dynamic"

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const userId = session.user.id
  const { tab } = await searchParams

  const ctx = await getUserTeam(userId)
  if (!ctx) redirect("/dashboard")
  const activeTeamId = ctx.teamId
  const myRole: TeamRole = ctx.role
  const canManage = canManageTeam(myRole)

  const team = await db.query.teams.findFirst({ where: eq(teams.id, activeTeamId) })
  if (!team) redirect("/dashboard")

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

  // ── Danger Zone gating (owner-only) ───────────────────────────────────
  // Surfaces why a delete is (dis)allowed; the actual guards re-run in deleteTeam.
  let danger: { liveAgents: number; childOrgs: number; ownedTeams: number } | null = null
  if (myRole === "owner") {
    const [liveAgentRows, childRows, ownedRows] = await Promise.all([
      db.query.instances.findMany({
        where: and(eq(instances.teamId, activeTeamId), ne(instances.status, "deleted")),
        columns: { id: true },
      }),
      db.query.teams.findMany({
        where: eq(teams.parentTeamId, activeTeamId),
        columns: { id: true },
      }),
      db.query.teams.findMany({ where: eq(teams.ownerId, userId), columns: { id: true } }),
    ])
    danger = {
      liveAgents: liveAgentRows.length,
      childOrgs: childRows.length,
      ownedTeams: ownedRows.length,
    }
  }

  // ── Plan label (highest active/trialing tier on the team owner) ───────
  const ownerSubs = await db.query.subscriptions.findMany({
    where: and(
      eq(subscriptions.userId, team.ownerId),
      inArray(subscriptions.status, ["active", "trialing"]),
    ),
    columns: {},
    with: { plan: { columns: { name: true, sortOrder: true } } },
  })
  const planLabel =
    ownerSubs
      .map((s) => s.plan)
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .sort((a, b) => b.sortOrder - a.sortOrder)[0]?.name ?? "Free"

  // Effective seat cap (explicit override or plan-derived). `Infinity` doesn't
  // survive the server→client boundary cleanly, so pass unlimited as `null`.
  const effectiveSeatLimit = await getTeamSeatLimit(team)
  const seatLimit = Number.isFinite(effectiveSeatLimit) ? effectiveSeatLimit : null

  // ── Team-shared providers (all keyed by the active team) ──────────────
  const driveConn = await db.query.driveConnections.findFirst({
    where: eq(driveConnections.teamId, activeTeamId),
  })
  const cloudflareConn = await db.query.cloudflareConnections.findFirst({
    where: eq(cloudflareConnections.teamId, activeTeamId),
  })
  const keyRows = await db.query.sshKeys.findMany({
    where: eq(sshKeys.teamId, activeTeamId),
    orderBy: desc(sshKeys.createdAt),
  })
  const backupRows = await db.query.backupRecords.findMany({
    where: eq(backupRecords.teamId, activeTeamId),
    orderBy: desc(backupRecords.createdAt),
    limit: 25,
  })

  return (
    <PageContainer>
      <PageHeader title="Team" description={team.name} />
      <TeamTabs
        active={tab || "members"}
        canManage={canManage}
        team={{ id: team.id, name: team.name, seatLimit, planLabel }}
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
        drive={{
          configured: isDriveConfigured(),
          connected: Boolean(driveConn),
          email: driveConn?.googleEmail ?? null,
        }}
        backups={backupRows.map((b) => ({
          id: b.id,
          fileName: b.fileName,
          agentName: b.agentName,
          sizeBytes: b.sizeBytes,
          createdAt: b.createdAt.toISOString(),
        }))}
        cloudflare={{
          connected: Boolean(cloudflareConn),
          accountName: cloudflareConn?.accountName ?? null,
          email: cloudflareConn?.email ?? null,
        }}
        sshKeys={keyRows.map((k) => ({
          id: k.id,
          name: k.name,
          fingerprint: k.fingerprint,
          createdAt: k.createdAt.toISOString(),
        }))}
        danger={danger}
      />
    </PageContainer>
  )
}
