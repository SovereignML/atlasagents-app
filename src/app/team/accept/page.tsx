import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { and, db, eq, isNull, teamInvites, teams, users } from "@/db"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

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
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl font-bold uppercase tracking-[0.05em]">
            Team Invite
          </CardTitle>
          <CardDescription>You&apos;ve been invited to join a team.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!invite && (
            <Alert variant="destructive">
              <AlertDescription>
                This invite is invalid or has already been used.
              </AlertDescription>
            </Alert>
          )}

          {invite && expired && (
            <Alert variant="destructive">
              <AlertDescription>This invite has expired. Ask for a new one.</AlertDescription>
            </Alert>
          )}

          {invite && !expired && wrongAccount && (
            <Alert>
              <AlertDescription>
                This invite is for <span className="font-mono">{wrongAccount}</span>. Sign out
                and sign in with that email to accept.
              </AlertDescription>
            </Alert>
          )}

          {invite && !expired && !wrongAccount && (
            <AcceptInviteClient
              token={token}
              teamName={teamName ?? "the team"}
              inviterName={inviterName ?? "Someone"}
              role={invite.role}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
