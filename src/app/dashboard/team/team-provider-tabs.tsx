"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Cloud, HardDriveDownload, Loader2, Plus, Trash2, Unlink } from "lucide-react"
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
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function formatBytes(n: number | null): string {
  if (!n) return "-"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const READ_ONLY = "Only team owners and admins can manage this."

// ── Backup Providers (Google Drive) ──────────────────────────────────────
export type DriveInfo = { configured: boolean; connected: boolean; email: string | null }
export type TeamBackup = {
  id: string
  fileName: string
  agentName: string
  sizeBytes: number | null
  createdAt: string
}

export function TeamBackupsTab({
  drive,
  backups,
  canManage,
}: {
  drive: DriveInfo
  backups: TeamBackup[]
  canManage: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function connect() {
    setBusy(true)
    try {
      const res = await fetch("/api/integrations/drive/connect")
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.url) {
        toast.error(j.error || "Could not start Google Drive connection")
        setBusy(false)
        return
      }
      window.location.href = j.url
    } catch {
      toast.error("Could not start Google Drive connection")
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    const res = await fetch("/api/integrations/drive/disconnect", { method: "POST" })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error || "Failed to disconnect")
    } else {
      toast.success("Google Drive disconnected")
      router.refresh()
    }
    setBusy(false)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDriveDownload className="size-5" /> Google Drive
          </CardTitle>
          <CardDescription>
            One shared Drive connection backs up every agent in this team.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          {!drive.configured ? (
            <Alert>
              <AlertDescription>
                Google Drive integration isn&apos;t configured on this platform.
              </AlertDescription>
            </Alert>
          ) : drive.connected ? (
            <>
              <Badge variant="default">Connected</Badge>
              {drive.email && (
                <span className="font-mono text-xs text-muted-foreground">{drive.email}</span>
              )}
              {canManage && (
                <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Unlink data-icon="inline-start" />}
                  Disconnect
                </Button>
              )}
            </>
          ) : (
            <>
              <Badge variant="secondary">Not connected</Badge>
              {canManage ? (
                <Button size="sm" onClick={connect} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  Connect Google Drive
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">{READ_ONLY}</span>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader className="p-6 pb-0">
          <CardTitle className="text-base">Recent backups</CardTitle>
          <CardDescription>Backups created across the team&apos;s agents.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {backups.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No backups yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Agent</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="pr-6">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backups.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="pl-6 text-foreground">{b.agentName}</TableCell>
                    <TableCell className="font-mono text-xs">{b.fileName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatBytes(b.sizeBytes)}
                    </TableCell>
                    <TableCell className="pr-6 text-xs text-muted-foreground">
                      {new Date(b.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Integrations (Cloudflare) ─────────────────────────────────────────────
export type CloudflareInfo = {
  connected: boolean
  accountName: string | null
  email: string | null
}

export function TeamIntegrationsTab({
  cloudflare,
  canManage,
}: {
  cloudflare: CloudflareInfo
  canManage: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState("")
  const [showConnect, setShowConnect] = useState(false)

  async function connect(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res = await fetch("/api/integrations/cloudflare/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(j.error || "Could not connect Cloudflare")
    } else {
      toast.success(`Cloudflare connected (${j.zonesCount ?? 0} zones)`)
      setToken("")
      setShowConnect(false)
      router.refresh()
    }
    setBusy(false)
  }

  async function disconnect() {
    setBusy(true)
    const res = await fetch("/api/integrations/cloudflare/disconnect", { method: "POST" })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(j.error || "Failed to disconnect")
    } else {
      const orphaned: string[] = j.orphaned ?? []
      toast.success(
        orphaned.length
          ? `Cloudflare disconnected. ${orphaned.length} domain record(s) left in your zone.`
          : "Cloudflare disconnected",
      )
      router.refresh()
    }
    setBusy(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="size-5" /> Cloudflare
        </CardTitle>
        <CardDescription>
          Connect a scoped Cloudflare API token so the team can put agents on subdomains of your
          own zones.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        {cloudflare.connected ? (
          <>
            <Badge variant="default">Connected</Badge>
            {(cloudflare.accountName || cloudflare.email) && (
              <span className="font-mono text-xs text-muted-foreground">
                {cloudflare.accountName ?? cloudflare.email}
              </span>
            )}
            {canManage && (
              <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Unlink data-icon="inline-start" />}
                Disconnect
              </Button>
            )}
          </>
        ) : (
          <>
            <Badge variant="secondary">Not connected</Badge>
            {canManage ? (
              <Dialog open={showConnect} onOpenChange={setShowConnect}>
                <DialogTrigger render={<Button size="sm">Connect Cloudflare</Button>} />
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Connect Cloudflare</DialogTitle>
                    <DialogDescription>
                      Paste a scoped API token with Zone:Read, Zone:DNS:Edit (and Zone
                      Settings:Edit to set SSL mode).
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={connect} className="space-y-4">
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="cf-token">API token</FieldLabel>
                        <Input
                          id="cf-token"
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                          className="font-mono"
                          placeholder="cloudflare API token"
                          required
                        />
                      </Field>
                    </FieldGroup>
                    <DialogFooter>
                      <DialogClose
                        render={<Button type="button" variant="outline">Cancel</Button>}
                      />
                      <Button type="submit" disabled={busy || !token.trim()}>
                        {busy ? <Loader2 className="animate-spin" /> : null}
                        Connect
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            ) : (
              <span className="text-xs text-muted-foreground">{READ_ONLY}</span>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── SSH Keys ──────────────────────────────────────────────────────────────
export type TeamSshKey = { id: string; name: string; fingerprint: string; createdAt: string }

export function TeamSshTab({
  keys: initialKeys,
  canManage,
}: {
  keys: TeamSshKey[]
  canManage: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState("")
  const [publicKey, setPublicKey] = useState("")
  const [pendingDelete, setPendingDelete] = useState<TeamSshKey | null>(null)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res = await fetch("/api/team/ssh-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || undefined, publicKey }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(j.error || "Could not add SSH key")
    } else {
      toast.success("SSH key added")
      setName("")
      setPublicKey("")
      setShowAdd(false)
      router.refresh()
    }
    setBusy(false)
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const res = await fetch(`/api/team/ssh-keys/${pendingDelete.id}`, { method: "DELETE" })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error || "Could not remove SSH key")
    } else {
      toast.success("SSH key removed")
      router.refresh()
    }
    setPendingDelete(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Shared SSH keys are available to the whole team when deploying agents.
        </p>
        {canManage && (
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger
              render={
                <Button size="sm">
                  <Plus data-icon="inline-start" /> Add key
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add an SSH key</DialogTitle>
                <DialogDescription>
                  Paste a public key (e.g. the contents of <code>id_ed25519.pub</code>).
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={add} className="space-y-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="ssh-name">Name (optional)</FieldLabel>
                    <Input
                      id="ssh-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="my-laptop"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ssh-key">Public key</FieldLabel>
                    <textarea
                      id="ssh-key"
                      value={publicKey}
                      onChange={(e) => setPublicKey(e.target.value)}
                      required
                      rows={4}
                      className="w-full rounded-md border bg-transparent p-2 font-mono text-xs"
                      placeholder="ssh-ed25519 AAAA..."
                    />
                  </Field>
                </FieldGroup>
                <DialogFooter>
                  <DialogClose render={<Button type="button" variant="outline">Cancel</Button>} />
                  <Button type="submit" disabled={busy || !publicKey.trim()}>
                    {busy ? <Loader2 className="animate-spin" /> : null}
                    Add key
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        {initialKeys.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No SSH keys yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Fingerprint</TableHead>
                <TableHead>Added</TableHead>
                {canManage && <TableHead className="pr-6 text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialKeys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="pl-6 text-foreground">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {k.fingerprint}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </TableCell>
                  {canManage && (
                    <TableCell className="pr-6 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setPendingDelete(k)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this SSH key?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `"${pendingDelete.name}" will no longer appear when deploying. Agents already using it keep working.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
