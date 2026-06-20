"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export type TeamDangerInfo = {
  liveAgents: number
  childOrgs: number
  ownedTeams: number
}

/** First blocking reason, or null when the team can be deleted. */
function blockReason(info: TeamDangerInfo): string | null {
  if (info.ownedTeams <= 1) {
    return "You can't delete your only team. Create another team first."
  }
  if (info.childOrgs > 0) {
    const n = info.childOrgs
    return `This team has ${n} customer organization${n === 1 ? "" : "s"} and can't be deleted.`
  }
  if (info.liveAgents > 0) {
    const n = info.liveAgents
    return `Delete or move this team's ${n} agent${n === 1 ? "" : "s"} before deleting it.`
  }
  return null
}

export function TeamDangerTab({
  team,
  info,
}: {
  team: { id: string; name: string }
  info: TeamDangerInfo
}) {
  const router = useRouter()
  const [confirmText, setConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const blocked = blockReason(info)
  const matches = confirmText === team.name

  async function doDelete() {
    setDeleting(true)
    setError(null)
    try {
      const r = await fetch("/api/team/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id }),
      })
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string }
        setError(body.error || r.statusText)
        setDeleting(false)
        return
      }
      // Server already moved the active team if needed; reload onto the new context.
      router.push("/dashboard/team")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-destructive/30 bg-destructive/5">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] tracking-[0.1em] uppercase text-destructive">
            Delete Team
          </CardDescription>
          <p className="text-sm text-muted-foreground">
            Permanently deletes <span className="font-medium">{team.name}</span> along with its
            members, invites, branding, connected providers, and SSH keys. This cannot be undone.
          </p>
        </CardHeader>
        <CardContent>
          {blocked ? (
            <Alert variant="destructive">
              <AlertDescription>{blocked}</AlertDescription>
            </Alert>
          ) : (
            <AlertDialog
              open={open}
              onOpenChange={(o) => {
                setOpen(o)
                if (!o) {
                  setConfirmText("")
                  setError(null)
                }
              }}
            >
              <AlertDialogTrigger
                render={
                  <Button variant="destructive">
                    <Trash2 data-icon="inline-start" />
                    Delete Team
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {team.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This cannot be undone. Type{" "}
                    <span className="font-mono text-destructive">{team.name}</span> to confirm.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="confirm-team">Team name</FieldLabel>
                    <Input
                      id="confirm-team"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={team.name}
                      className="font-mono"
                    />
                  </Field>
                </FieldGroup>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>Delete failed: {error}</AlertDescription>
                  </Alert>
                )}
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={!matches || deleting}
                    onClick={(e) => {
                      e.preventDefault()
                      doDelete()
                    }}
                  >
                    {deleting ? "Deleting…" : "I understand, delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
