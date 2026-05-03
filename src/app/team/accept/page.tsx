import { auth } from "@/auth"
import { db, eq, and, isNull, teamInvites, teams, users } from "@/db"
import { redirect } from "next/navigation"
import { AcceptInviteClient } from "./accept-client"

export const dynamic = "force-dynamic"

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  if (!token) redirect("/dashboard")

  const session = await auth()
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/team/accept?token=${token}`)}`)
  }

  const invite = await db.query.teamInvites.findFirst({
    where: and(
      eq(teamInvites.token, token),
      isNull(teamInvites.acceptedAt),
      isNull(teamInvites.revokedAt),
    ),
  })

  let teamName: string | null = null
  let inviterName: string | null = null
  let expired = false
  let wrongAccount: string | null = null

  if (invite) {
    if (invite.expiresAt < new Date()) {
      expired = true
    }
    const team = await db.query.teams.findFirst({ where: eq(teams.id, invite.teamId) })
    teamName = team?.name ?? null
    const inviter = await db.query.users.findFirst({
      where: eq(users.id, invite.invitedById),
      columns: { name: true, email: true },
    })
    inviterName = inviter?.name || inviter?.email || null

    const me = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { email: true },
    })
    if (me?.email && me.email.toLowerCase() !== invite.email.toLowerCase()) {
      wrongAccount = invite.email
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--bg-color)]">
      <div className="w-full max-w-md border border-[var(--border-color)] bg-[var(--card-bg)] p-8 space-y-6">
        <h1
          className="text-xl font-bold uppercase tracking-[0.05em] text-[var(--text-primary)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Team Invite
        </h1>

        {!invite && (
          <p className="text-sm text-red-400">This invite is invalid or has already been used.</p>
        )}

        {invite && expired && (
          <p className="text-sm text-red-400">This invite has expired. Ask for a new one.</p>
        )}

        {invite && !expired && wrongAccount && (
          <p className="text-sm text-amber-400">
            This invite is for <span className="font-mono">{wrongAccount}</span>. Sign out and sign
            in with that email to accept.
          </p>
        )}

        {invite && !expired && !wrongAccount && (
          <AcceptInviteClient
            token={token}
            teamName={teamName ?? "the team"}
            inviterName={inviterName ?? "Someone"}
            role={invite.role}
          />
        )}
      </div>
    </div>
  )
}
