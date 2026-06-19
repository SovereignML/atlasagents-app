"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { TeamRole } from "@/lib/team"

type Member = { userId: string; role: TeamRole; name: string | null; email: string }
type Invite = { id: string; email: string; role: TeamRole; expiresAt: string }

function roleBadgeVariant(role: TeamRole): "default" | "secondary" | "outline" {
  switch (role) {
    case "owner":
      return "default"
    case "admin":
      return "outline"
    default:
      return "secondary"
  }
}

type TeamInfo = { teamId: string; name: string; role: TeamRole }

export function TeamClient({
  team,
  myRole,
  members,
  invites,
  allTeams = [],
  activeTeamId,
  embedded = false,
}: {
  team: { id: string; name: string; seatLimit: number; planLabel: string }
  myRole: TeamRole
  members: Member[]
  invites: Invite[]
  allTeams?: TeamInfo[]
  activeTeamId?: string
  /** When true, render inside the Team page tabs (no outer container/switcher). */
  embedded?: boolean
}) {
  const router = useRouter()
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<TeamRole>("developer")
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [pendingRevokeInvite, setPendingRevokeInvite] = useState<Invite | null>(null)
  const [pendingRemoveMember, setPendingRemoveMember] = useState<Member | null>(null)

  const canManage = myRole === "owner" || myRole === "admin"
  const assignableRoles: TeamRole[] =
    myRole === "owner" ? ["admin", "developer", "viewer"] : ["developer", "viewer"]

  const seatsUsed = members.length + invites.length

  function refresh() {
    router.refresh()
  }

  async function handleSwitchTeam(teamId: string) {
    if (teamId === activeTeamId) return
    setSwitching(true)
    setError(null)
    const res = await fetch("/api/team/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || "Failed to switch team")
      setSwitching(false)
      return
    }
    router.refresh()
  }

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    const res = await fetch("/api/team/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || "Failed to send invite")
      return
    }
    setInviteEmail("")
    if (!data.emailSent && data.acceptUrl) {
      setInfo(`Invite created. Email not configured. Share this link: ${data.acceptUrl}`)
    } else {
      setInfo(`Invite sent to ${data.invite.email}.`)
    }
    setShowInvite(false)
    startTransition(refresh)
  }

  async function confirmRevokeInvite() {
    if (!pendingRevokeInvite) return
    const res = await fetch(`/api/team/invites/${pendingRevokeInvite.id}`, { method: "DELETE" })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || "Failed to revoke")
    }
    setPendingRevokeInvite(null)
    startTransition(refresh)
  }

  async function changeRole(userId: string, role: TeamRole) {
    const res = await fetch(`/api/team/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || "Failed to change role")
      return
    }
    startTransition(refresh)
  }

  async function confirmRemoveMember() {
    if (!pendingRemoveMember) return
    const res = await fetch(`/api/team/members/${pendingRemoveMember.userId}`, { method: "DELETE" })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || "Failed to remove")
    }
    setPendingRemoveMember(null)
    startTransition(refresh)
  }

  const content = (
    <>
      {!embedded && allTeams.length > 1 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4">
            <span className="text-xs text-muted-foreground">Active Team</span>
            <Select
              value={activeTeamId ?? team.id}
              onValueChange={(v) => v && handleSwitchTeam(v)}
              disabled={switching}
            >
              <SelectTrigger className="min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {allTeams.map((t) => (
                    <SelectItem key={t.teamId} value={t.teamId}>
                      {t.name} ({t.role})
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {switching && (
              <span className="animate-pulse font-mono text-xs text-muted-foreground">
                Switching...
              </span>
            )}
          </CardContent>
        </Card>
      )}

      <PageHeader
        title={embedded ? "Members" : "Team"}
        description={`${team.name} · invite teammates and control their access.`}
        actions={
          canManage && (
            <Dialog open={showInvite} onOpenChange={setShowInvite}>
              <DialogTrigger
                render={
                  <Button variant="gradient" size="pill" disabled={seatsUsed >= team.seatLimit}>
                    <Plus data-icon="inline-start" />
                    Invite Member
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite a teammate</DialogTitle>
                  <DialogDescription>
                    They&apos;ll receive an email with a link to join {team.name}.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={submitInvite} className="space-y-4">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                      <Input
                        id="invite-email"
                        type="email"
                        required
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        className="font-mono"
                        placeholder="teammate@company.com"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="invite-role">Role</FieldLabel>
                      <Select
                        value={inviteRole}
                        onValueChange={(v) => v && setInviteRole(v as TeamRole)}
                      >
                        <SelectTrigger id="invite-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {assignableRoles.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </FieldGroup>
                  <DialogFooter>
                    <DialogClose render={<Button type="button" variant="outline">Cancel</Button>} />
                    <Button type="submit" disabled={busy}>
                      Send invite
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info && (
        <Alert>
          <AlertTitle>Invite created</AlertTitle>
          <AlertDescription className="break-all">{info}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardDescription className="text-xs">Plan</CardDescription>
            <CardTitle className="font-mono text-2xl">{team.planLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Up to {team.seatLimit} seats</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription className="text-xs">Seats Used</CardDescription>
            <CardTitle className="font-mono text-2xl text-foreground">
              {seatsUsed}{" "}
              <span className="text-muted-foreground">/ {team.seatLimit}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${Math.min(100, team.seatLimit > 0 ? (seatsUsed / team.seatLimit) * 100 : 0)}%`,
                }}
              />
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription className="text-xs">Pending Invites</CardDescription>
            <CardTitle className="font-mono text-2xl">{invites.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-5 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.userId}>
                <TableCell className="pl-5 text-foreground">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium uppercase text-foreground">
                      {(m.name || m.email).charAt(0)}
                    </span>
                    <div>
                      <div>{m.name || m.email}</div>
                      {m.name && (
                        <div className="font-mono text-xs text-muted-foreground">{m.email}</div>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {canManage && m.role !== "owner" ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) => v && changeRole(m.userId, v as TeamRole)}
                    >
                      <SelectTrigger size="sm" className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {assignableRoles.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge
                      variant={roleBadgeVariant(m.role)}
                      className={cn(
                        "font-mono",
                        m.role === "owner" && "bg-foreground text-background",
                      )}
                    >
                      {m.role}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
                    active
                  </span>
                </TableCell>
                <TableCell className="pr-5 text-right">
                  {canManage && m.role !== "owner" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setPendingRemoveMember(m)}
                    >
                      Remove
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {invites.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="pl-5 font-mono text-foreground">{i.email}</TableCell>
                <TableCell>
                  <Badge variant={roleBadgeVariant(i.role)} className="font-mono">
                    {i.role}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-amber-500">invited</TableCell>
                <TableCell className="pr-5 text-right">
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setPendingRevokeInvite(i)}
                    >
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription className="text-xs">Roles</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-sm text-muted-foreground md:grid-cols-2">
          <div>
            <span className="font-mono text-primary">owner</span>: full access incl. billing
          </div>
          <div>
            <span className="font-mono text-amber-500">admin</span>: manage agents, team, settings
            (no billing)
          </div>
          <div>
            <span className="font-mono text-foreground">developer</span>: deploy, restart, edit
            agents
          </div>
          <div>
            <span className="font-mono">viewer</span>: read-only dashboards and logs
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingRevokeInvite !== null}
        onOpenChange={(o) => !o && setPendingRevokeInvite(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this invite?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRevokeInvite
                ? `${pendingRevokeInvite.email} will no longer be able to join the team.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRevokeInvite}>Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingRemoveMember !== null}
        onOpenChange={(o) => !o && setPendingRemoveMember(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this member?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemoveMember
                ? `${pendingRemoveMember.name || pendingRemoveMember.email} will lose access to ${team.name}.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveMember}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

  return embedded ? (
    <div className="space-y-10">{content}</div>
  ) : (
    <PageContainer>{content}</PageContainer>
  )
}
