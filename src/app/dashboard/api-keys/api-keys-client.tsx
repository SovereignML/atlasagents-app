"use client"

import { useState } from "react"
import { Copy, Plus } from "lucide-react"

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
import { Card, CardContent } from "@/components/ui/card"
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Key = {
  id: string
  name: string
  prefix: string
  created: string
  lastUsed: string
  scopes: string[]
}

export function ApiKeysClient({ initial }: { initial: Key[] }) {
  const [keys, setKeys] = useState<Key[]>(initial)
  const [creating, setCreating] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [revokeId, setRevokeId] = useState<string | null>(null)

  function handleCreate() {
    if (!newKeyName.trim()) return
    const secret = `sk_live_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`
    const prefix = secret.slice(0, 12)
    setKeys((prev) => [
      {
        id: `ak_${Date.now()}`,
        name: newKeyName.trim(),
        prefix,
        created: new Date().toISOString().slice(0, 10),
        lastUsed: "never",
        scopes: ["agents:read", "agents:write"],
      },
      ...prev,
    ])
    setRevealedSecret(secret)
    setNewKeyName("")
    setCreating(false)
  }

  function handleConfirmRevoke() {
    if (!revokeId) return
    setKeys((prev) => prev.filter((k) => k.id !== revokeId))
    setRevokeId(null)
  }

  const newKeyDialog = (
    <Dialog open={creating} onOpenChange={setCreating}>
      <DialogTrigger
        render={
          <Button variant="gradient" size="pill">
            <Plus data-icon="inline-start" />
            New Key
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>
            Pick a memorable name to identify where this key is used.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
            <Input
              id="api-key-name"
              autoFocus
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. Production, CI, local-dev"
              className="font-mono"
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button onClick={handleCreate} disabled={!newKeyName.trim()}>
            Create key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return (
    <PageContainer>
      <PageHeader
        title="API Keys"
        description="Personal access tokens for the public API. Treat like passwords — never commit them."
        actions={newKeyDialog}
      />

      {revealedSecret && (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300">
          <AlertTitle>Copy now — you won&apos;t see this again</AlertTitle>
          <AlertDescription className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 break-all rounded-lg border bg-background/70 px-3 py-2 font-mono text-sm text-foreground">
                {revealedSecret}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigator.clipboard.writeText(revealedSecret)}
              >
                <Copy data-icon="inline-start" />
                Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRevealedSecret(null)}>
                Done
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {keys.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No keys yet</EmptyTitle>
                <EmptyDescription>Create one to get started.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium text-foreground">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {k.prefix}••••••••
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} variant="outline" className="font-mono text-[10px]">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {k.created}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {k.lastUsed}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRevokeId(k.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <p className="font-mono text-[10px] text-amber-500/80">
        ⚠ local UI state only — ApiKey model + `/api/keys` endpoints pending
      </p>

      <AlertDialog open={revokeId !== null} onOpenChange={(o) => !o && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this key?</AlertDialogTitle>
            <AlertDialogDescription>
              Clients using this key will stop working immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRevoke}>Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  )
}
