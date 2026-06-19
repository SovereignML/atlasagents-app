"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Plus, Trash2, UserPlus } from "lucide-react"
import { toast } from "sonner"

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

type Level = "viewer" | "operator" | "manager"
type Grant = {
  userId: string
  name: string | null
  email: string
  level: Level
  grantedById: string
  createdAt: string
}
type Member = { userId: string; name: string | null; email: string; teamRole: string }

const LEVEL_HELP: Record<Level, string> = {
  viewer: "Read-only: status & logs",
  operator: "Restart, backup, bind domains",
  manager: "Full control + re-share access",
}

export function AccessTab({
  instanceId,
  isOwnerLike,
}: {
  instanceId: string
  /** Creator/team-owner — the only roles that may grant the manager level. */
  isOwnerLike: boolean
}) {
  const [loading, setLoading] = useState(true)
  const [grants, setGrants] = useState<Grant[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [granteeId, setGranteeId] = useState("")
  const [level, setLevel] = useState<Level>("viewer")
  const [busy, setBusy] = useState(false)
  const [pendingRevoke, setPendingRevoke] = useState<Grant | null>(null)

  const grantableLevels: Level[] = isOwnerLike
    ? ["viewer", "operator", "manager"]
    : ["viewer", "operator"]

  const load = useCallback(async () => {
    const res = await fetch(`/api/instances/${instanceId}/access`)
    if (res.ok) {
      const j = await res.json()
      setGrants(j.grants ?? [])
      setMembers(j.members ?? [])
    }
    setLoading(false)
  }, [instanceId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  // Members without an existing grant (candidates for the picker).
  const granted = new Set(grants.map((g) => g.userId))
  const candidates = members.filter((m) => !granted.has(m.userId))

  async function addGrant(e: React.FormEvent) {
    e.preventDefault()
    if (!granteeId) return
    setBusy(true)
    const res = await fetch(`/api/instances/${instanceId}/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: granteeId, level }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(j.error || "Could not grant access")
    } else {
      toast.success("Access granted")
      setGranteeId("")
      setLevel("viewer")
      setShowAdd(false)
      await load()
    }
    setBusy(false)
  }

  async function changeLevel(userId: string, newLevel: Level) {
    const res = await fetch(`/api/instances/${instanceId}/access/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: newLevel }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(j.error || "Could not update access")
    } else {
      await load()
    }
  }

  async function confirmRevoke() {
    if (!pendingRevoke) return
    const res = await fetch(`/api/instances/${instanceId}/access/${pendingRevoke.userId}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error || "Could not revoke access")
    } else {
      toast.success("Access revoked")
      await load()
    }
    setPendingRevoke(null)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Agent access</CardTitle>
          <CardDescription>
            Share this agent with teammates. The owner and team owner always have full access.
          </CardDescription>
        </div>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger
            render={
              <Button size="sm" disabled={candidates.length === 0}>
                <UserPlus data-icon="inline-start" /> Share
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Share this agent</DialogTitle>
              <DialogDescription>Grant a teammate access at a chosen level.</DialogDescription>
            </DialogHeader>
            <form onSubmit={addGrant} className="space-y-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="grantee">Teammate</FieldLabel>
                  <Select value={granteeId} onValueChange={(v) => v && setGranteeId(v)}>
                    <SelectTrigger id="grantee">
                      <SelectValue placeholder="Select a team member" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {candidates.map((m) => (
                          <SelectItem key={m.userId} value={m.userId}>
                            {m.name || m.email}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="level">Access level</FieldLabel>
                  <Select value={level} onValueChange={(v) => v && setLevel(v as Level)}>
                    <SelectTrigger id="level">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {grantableLevels.map((l) => (
                          <SelectItem key={l} value={l}>
                            {l}: {LEVEL_HELP[l]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline">Cancel</Button>} />
                <Button type="submit" disabled={busy || !granteeId}>
                  {busy ? <Loader2 className="animate-spin" /> : <Plus data-icon="inline-start" />}
                  Grant access
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : grants.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            No one else has access yet. Use “Share” to grant a teammate.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Level</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((g) => (
                <TableRow key={g.userId}>
                  <TableCell className="text-foreground">
                    <div>{g.name || g.email}</div>
                    {g.name && (
                      <div className="font-mono text-xs text-muted-foreground">{g.email}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* Only owner-like actors can promote to manager; others cap at operator. */}
                    {g.level === "manager" && !isOwnerLike ? (
                      <Badge variant="outline" className="font-mono">
                        manager
                      </Badge>
                    ) : (
                      <Select
                        value={g.level}
                        onValueChange={(v) => v && changeLevel(g.userId, v as Level)}
                      >
                        <SelectTrigger size="sm" className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {grantableLevels.map((l) => (
                              <SelectItem key={l} value={l}>
                                {l}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setPendingRevoke(g)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AlertDialog open={pendingRevoke !== null} onOpenChange={(o) => !o && setPendingRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke access?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRevoke
                ? `${pendingRevoke.name || pendingRevoke.email} will lose access to this agent.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRevoke}>Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
