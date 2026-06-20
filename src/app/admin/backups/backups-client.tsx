"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { DatabaseBackup, Download, RotateCcw, Trash2, Plug } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { PageSection } from "@/components/layout/page-container"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export type BackupRow = {
  id: string
  objectKey: string
  fileName: string
  sizeBytes: number | null
  status: string
  error: string | null
  trigger: string
  startedAt: string | null
  completedAt: string | null
  existsInR2: boolean | null
}

type Settings = {
  configured: boolean
  accountId: string
  bucket: string
  endpoint: string
  retentionCount: number
}

function formatBytes(n: number | null): string {
  if (!n) return "-"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(iso: string | null): string {
  if (!iso) return "-"
  return new Date(iso).toLocaleString()
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "success") return "default"
  if (status === "failed") return "destructive"
  return "outline"
}

export function BackupsClient({
  initialSettings,
  initialBackups,
}: {
  initialSettings: Settings
  initialBackups: BackupRow[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  // ── Settings form state ──
  const [accountId, setAccountId] = useState(initialSettings.accountId)
  const [bucket, setBucket] = useState(initialSettings.bucket)
  const [endpoint, setEndpoint] = useState(initialSettings.endpoint)
  const [retentionCount, setRetentionCount] = useState(String(initialSettings.retentionCount))
  const [accessKeyId, setAccessKeyId] = useState("")
  const [secretAccessKey, setSecretAccessKey] = useState("")
  const [savingSettings, setSavingSettings] = useState(false)
  const [testing, setTesting] = useState(false)

  // ── Action state ──
  const [backingUp, setBackingUp] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  // ── Restore dialog state ──
  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null)
  const [restoreConfirm, setRestoreConfirm] = useState("")
  const [restoring, setRestoring] = useState(false)

  function refresh() {
    startTransition(() => router.refresh())
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSavingSettings(true)
    try {
      const payload: Record<string, string> = { accountId, bucket, endpoint, retentionCount }
      if (accessKeyId) payload.accessKeyId = accessKeyId
      if (secretAccessKey) payload.secretAccessKey = secretAccessKey
      const res = await fetch("/api/admin/backups/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || "Could not save")
      toast.success("R2 settings saved")
      setAccessKeyId("")
      setSecretAccessKey("")
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save")
    } finally {
      setSavingSettings(false)
    }
  }

  async function testConnection() {
    setTesting(true)
    try {
      // Test what's typed if a full set is present; otherwise the saved config.
      const payload: Record<string, string> = {}
      if (accountId && bucket && accessKeyId && secretAccessKey) {
        Object.assign(payload, { accountId, bucket, endpoint, accessKeyId, secretAccessKey })
      }
      const res = await fetch("/api/admin/backups/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) throw new Error(body.error || "Connection failed")
      toast.success("Connected to R2 bucket")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection failed")
    } finally {
      setTesting(false)
    }
  }

  async function backupNow() {
    setBackingUp(true)
    const t = toast.loading("Backing up database… this can take a while")
    try {
      const res = await fetch("/api/admin/backups", { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || "Backup failed")
      toast.success(`Backup created: ${body.backup?.fileName ?? "ok"}`, { id: t })
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backup failed", { id: t })
    } finally {
      setBackingUp(false)
    }
  }

  async function download(b: BackupRow) {
    setBusyId(b.id)
    try {
      const res = await fetch(`/api/admin/backups/${b.id}/download`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || "Could not create download link")
      window.location.href = body.url
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed")
    } finally {
      setBusyId(null)
    }
  }

  async function remove(b: BackupRow) {
    setBusyId(b.id)
    try {
      const res = await fetch(`/api/admin/backups/${b.id}`, { method: "DELETE" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || "Delete failed")
      toast.success("Backup deleted")
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    } finally {
      setBusyId(null)
    }
  }

  async function confirmRestore() {
    if (!restoreTarget) return
    setRestoring(true)
    try {
      const res = await fetch(`/api/admin/backups/${restoreTarget.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: restoreConfirm }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || "Restore failed")
      toast.success(
        body.warnings ? "Restore completed with warnings (see logs)" : "Database restored",
      )
      setRestoreTarget(null)
      setRestoreConfirm("")
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed")
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="space-y-10">
      {/* ── R2 settings ── */}
      <PageSection
        title="Cloudflare R2 connection"
        description="Where backups are stored. Credentials are encrypted at rest and never returned to the browser."
      >
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={saveSettings} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="r2-account">Account ID</FieldLabel>
                  <Input
                    id="r2-account"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    placeholder="Cloudflare account ID"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="r2-bucket">Bucket</FieldLabel>
                  <Input
                    id="r2-bucket"
                    value={bucket}
                    onChange={(e) => setBucket(e.target.value)}
                    placeholder="sovereign-backups"
                    required
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="r2-endpoint">Endpoint (optional)</FieldLabel>
                <Input
                  id="r2-endpoint"
                  type="url"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://<account>.r2.cloudflarestorage.com"
                />
                <FieldDescription>
                  Leave blank to use the default R2 endpoint for your account.
                </FieldDescription>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="r2-access">Access key ID</FieldLabel>
                  <Input
                    id="r2-access"
                    type="password"
                    value={accessKeyId}
                    onChange={(e) => setAccessKeyId(e.target.value)}
                    placeholder={
                      initialSettings.configured ? "•••••••• (leave blank to keep)" : "R2 access key ID"
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="r2-secret">Secret access key</FieldLabel>
                  <Input
                    id="r2-secret"
                    type="password"
                    value={secretAccessKey}
                    onChange={(e) => setSecretAccessKey(e.target.value)}
                    placeholder={
                      initialSettings.configured ? "•••••••• (leave blank to keep)" : "R2 secret access key"
                    }
                  />
                </Field>
              </div>
              <Field className="sm:max-w-xs">
                <FieldLabel htmlFor="r2-retention">Retention (keep newest N)</FieldLabel>
                <Input
                  id="r2-retention"
                  type="number"
                  min={1}
                  max={365}
                  value={retentionCount}
                  onChange={(e) => setRetentionCount(e.target.value)}
                />
                <FieldDescription>Older successful backups are pruned automatically.</FieldDescription>
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={savingSettings}>
                  {savingSettings ? "Saving…" : "Save"}
                </Button>
                <Button type="button" variant="outline" onClick={testConnection} disabled={testing}>
                  <Plug />
                  {testing ? "Testing…" : "Test connection"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </PageSection>

      {/* ── Backups ── */}
      <PageSection
        title="Backups"
        description="Full pg_dump snapshots of the entire database."
        actions={
          <Button onClick={backupNow} disabled={backingUp}>
            <DatabaseBackup />
            {backingUp ? "Backing up…" : "Back up now"}
          </Button>
        }
      >
        <Card>
          <CardHeader className="sr-only">
            <CardTitle>Backups</CardTitle>
            <CardDescription>Database backups stored in R2.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {initialBackups.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No backups yet. Configure R2 above, then “Back up now”.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {initialBackups.map((b) => {
                    const canRestore = b.status === "success" && b.existsInR2 !== false
                    return (
                      <TableRow key={b.id}>
                        <TableCell>{formatDate(b.startedAt)}</TableCell>
                        <TableCell className="font-mono text-xs">{b.fileName}</TableCell>
                        <TableCell>{formatBytes(b.sizeBytes)}</TableCell>
                        <TableCell className="capitalize">{b.trigger}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(b.status)} className="capitalize">
                            {b.status}
                          </Badge>
                          {b.existsInR2 === false && b.status === "success" && (
                            <Badge variant="outline" className="ml-1">
                              missing in R2
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="Download"
                              disabled={!canRestore || busyId === b.id}
                              onClick={() => download(b)}
                            >
                              <Download />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="Restore"
                              disabled={!canRestore || busyId === b.id}
                              onClick={() => {
                                setRestoreConfirm("")
                                setRestoreTarget(b)
                              }}
                            >
                              <RotateCcw />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="Delete"
                              disabled={busyId === b.id}
                              onClick={() => remove(b)}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </PageSection>

      {/* ── Restore confirmation ── */}
      <AlertDialog
        open={!!restoreTarget}
        onOpenChange={(open) => {
          if (!open && !restoring) {
            setRestoreTarget(null)
            setRestoreConfirm("")
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore the entire database?</AlertDialogTitle>
            <AlertDialogDescription>
              This overwrites <strong>all live data</strong> with the contents of{" "}
              <span className="font-mono">{restoreTarget?.fileName}</span> using{" "}
              <span className="font-mono">pg_restore --clean</span>. This cannot be undone. Quiesce
              the app first. Type <strong>RESTORE</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={restoreConfirm}
            onChange={(e) => setRestoreConfirm(e.target.value)}
            placeholder="RESTORE"
          />
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={restoring}
              onClick={() => {
                setRestoreTarget(null)
                setRestoreConfirm("")
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={restoreConfirm !== "RESTORE" || restoring}
              onClick={confirmRestore}
            >
              {restoring ? "Restoring…" : "Restore database"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
