"use client"

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react"
import {
  ArrowUp,
  Download,
  File as FileIcon,
  Folder,
  FolderPlus,
  Home,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type FileEntry = {
  name: string
  type: "dir" | "file" | "other"
  size: number
  modifiedAt: number | null
}

type ListResponse = {
  root: string
  path: string
  entries: FileEntry[]
  error?: string
}

function formatBytes(n: number): string {
  if (!n) return "0 B"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Join the current relative directory with a child name. */
function joinRel(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

export function FilesTab({
  instanceId,
  status,
  deploymentTarget,
  runtimeLabel,
}: {
  instanceId: string
  status: string
  deploymentTarget: string | null
  runtimeLabel: string
}) {
  const supported = deploymentTarget === "vps" || deploymentTarget === "byos"

  if (!supported) {
    return (
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[11px] tracking-[0.14em] uppercase">
            Files
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The file browser is only available for agents running on a dedicated VPS or your own
            server (BYOS).
          </p>
        </CardContent>
      </Card>
    )
  }

  if (status !== "running") {
    return (
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[11px] tracking-[0.14em] uppercase">
            Files
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The agent must be running to browse its files. Current status:{" "}
            <span className="font-mono text-foreground">{status}</span>.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <FileBrowser instanceId={instanceId} runtimeLabel={runtimeLabel} />
  )
}

function FileBrowser({
  instanceId,
  runtimeLabel,
}: {
  instanceId: string
  runtimeLabel: string
}) {
  const [path, setPath] = useState("")
  const [root, setRoot] = useState<string | null>(null)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(
    async (targetPath: string) => {
      setLoading(true)
      setError(null)
      try {
        const r = await fetch(
          `/api/instances/${instanceId}/files?path=${encodeURIComponent(targetPath)}`,
          { cache: "no-store" },
        )
        const j = (await r.json()) as ListResponse
        if (!r.ok) {
          setError(j.error || "Could not load files.")
          setEntries([])
          return
        }
        setRoot(j.root)
        setEntries(j.entries ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load files.")
        setEntries([])
      } finally {
        setLoading(false)
      }
    },
    [instanceId],
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(path)
  }, [load, path])

  function navigateTo(next: string) {
    setPath(next)
  }

  function goUp() {
    if (!path) return
    const idx = path.lastIndexOf("/")
    setPath(idx === -1 ? "" : path.slice(0, idx))
  }

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files)
    if (list.length === 0) return
    setUploading(true)
    try {
      for (const file of list) {
        const form = new FormData()
        form.append("path", path)
        form.append("file", file)
        const r = await fetch(`/api/instances/${instanceId}/files/upload`, {
          method: "POST",
          body: form,
        })
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        if (!r.ok) {
          toast.error(`${file.name}: ${j.error || "Upload failed."}`)
        } else {
          toast.success(`Uploaded ${file.name}`)
        }
      }
      await load(path)
    } finally {
      setUploading(false)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) {
      void uploadFiles(e.dataTransfer.files)
    }
  }

  const segments = path ? path.split("/") : []

  return (
    <Card
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        setDragOver(false)
      }}
      onDrop={onDrop}
      className={cn(dragOver && "border-primary ring-2 ring-primary/40")}
    >
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardDescription className="font-mono text-[11px] tracking-[0.14em] uppercase">
            Files · {runtimeLabel}
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2">
            <NewFolderButton
              onCreate={async (name) => {
                const r = await fetch(`/api/instances/${instanceId}/files`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ op: "mkdir", path: joinRel(path, name) }),
                })
                const j = (await r.json().catch(() => ({}))) as { error?: string }
                if (!r.ok) {
                  toast.error(j.error || "Could not create folder.")
                  return false
                }
                toast.success(`Created folder "${name}"`)
                await load(path)
                return true
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Upload data-icon="inline-start" />
              )}
              Upload
            </Button>
            <Button size="sm" variant="ghost" disabled={loading} onClick={() => load(path)}>
              <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : ""} />
              Refresh
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void uploadFiles(e.target.files)
                e.target.value = ""
              }}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Breadcrumb */}
        <div className="flex flex-wrap items-center gap-1 font-mono text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => navigateTo("")}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
          >
            <Home className="size-3.5" />
            agent home
          </button>
          {segments.map((seg, i) => {
            const upto = segments.slice(0, i + 1).join("/")
            return (
              <span key={upto} className="inline-flex items-center gap-1">
                <span className="text-muted-foreground/50">/</span>
                <button
                  type="button"
                  onClick={() => navigateTo(upto)}
                  className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
                >
                  {seg}
                </button>
              </span>
            )
          })}
        </div>

        {root && (
          <p className="font-mono text-[10px] text-muted-foreground/60">
            {root}
            {path ? `/${path}` : ""}
          </p>
        )}

        {/* Listing */}
        <div className="rounded-lg border border-border">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={!path}
              onClick={goUp}
              aria-label="Up one level"
            >
              <ArrowUp className="size-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              {loading ? "Loading…" : `${entries.length} item${entries.length === 1 ? "" : "s"}`}
            </span>
            {dragOver && (
              <span className="ml-auto text-xs font-medium text-primary">Drop to upload…</span>
            )}
          </div>

          {error ? (
            <p className="px-3 py-6 text-sm text-destructive">{error}</p>
          ) : loading ? (
            <p className="px-3 py-6 text-sm text-muted-foreground">Loading files…</p>
          ) : entries.length === 0 ? (
            <p className="px-3 py-6 text-sm text-muted-foreground">
              This folder is empty. Drag files here or use Upload.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((entry) => (
                <FileRow
                  key={entry.name}
                  instanceId={instanceId}
                  dir={path}
                  entry={entry}
                  onOpen={() => entry.type === "dir" && navigateTo(joinRel(path, entry.name))}
                  onChanged={() => load(path)}
                />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function FileRow({
  instanceId,
  dir,
  entry,
  onOpen,
  onChanged,
}: {
  instanceId: string
  dir: string
  entry: FileEntry
  onOpen: () => void
  onChanged: () => void
}) {
  const rel = joinRel(dir, entry.name)
  const isDir = entry.type === "dir"
  const isFile = entry.type === "file"

  return (
    <li className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
      <button
        type="button"
        onClick={onOpen}
        disabled={!isDir}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 text-left",
          isDir && "cursor-pointer",
        )}
      >
        {isDir ? (
          <Folder className="size-4 shrink-0 text-primary" />
        ) : (
          <FileIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-sm text-foreground">{entry.name}</span>
      </button>

      <span className="hidden w-20 shrink-0 text-right font-mono text-[11px] text-muted-foreground sm:inline">
        {isFile ? formatBytes(entry.size) : isDir ? "—" : ""}
      </span>
      <span className="hidden w-36 shrink-0 text-right font-mono text-[11px] text-muted-foreground md:inline">
        {entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : ""}
      </span>

      <div className="flex shrink-0 items-center gap-0.5">
        {isFile && (
          <>
            <EditFileButton instanceId={instanceId} rel={rel} name={entry.name} onSaved={onChanged} />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Download ${entry.name}`}
              render={
                <a
                  href={`/api/instances/${instanceId}/files/download?path=${encodeURIComponent(rel)}`}
                  download={entry.name}
                >
                  <Download className="size-4" />
                </a>
              }
            />
          </>
        )}
        <RenameButton
          instanceId={instanceId}
          dir={dir}
          rel={rel}
          name={entry.name}
          onRenamed={onChanged}
        />
        <DeleteButton
          instanceId={instanceId}
          rel={rel}
          name={entry.name}
          isDir={isDir}
          onDeleted={onChanged}
        />
      </div>
    </li>
  )
}

function EditFileButton({
  instanceId,
  rel,
  name,
  onSaved,
}: {
  instanceId: string
  rel: string
  name: string
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tooLarge, setTooLarge] = useState(false)

  async function openEditor() {
    setOpen(true)
    setLoading(true)
    setTooLarge(false)
    try {
      const r = await fetch(
        `/api/instances/${instanceId}/files/content?path=${encodeURIComponent(rel)}`,
        { cache: "no-store" },
      )
      const j = (await r.json()) as {
        content?: string
        truncated?: boolean
        error?: string
      }
      if (!r.ok) {
        toast.error(j.error || "Could not open file.")
        setOpen(false)
        return
      }
      if (j.truncated) {
        setTooLarge(true)
        setContent("")
        return
      }
      setContent(j.content ?? "")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open file.")
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      const r = await fetch(`/api/instances/${instanceId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rel, content }),
      })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) {
        toast.error(j.error || "Could not save file.")
        return
      }
      toast.success(`Saved ${name}`)
      setOpen(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Edit ${name}`}
        onClick={openEditor}
      >
        <Pencil className="size-4" />
      </Button>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{name}</DialogTitle>
          <DialogDescription>Edit this file and save it back to the agent.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : tooLarge ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            This file is too large to edit in the browser. Download it instead.
          </p>
        ) : (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={18}
            className="resize-y font-mono text-xs"
            spellCheck={false}
          />
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={saving}>Cancel</Button>} />
          <Button onClick={save} disabled={saving || loading || tooLarge}>
            {saving ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Save data-icon="inline-start" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RenameButton({
  instanceId,
  dir,
  rel,
  name,
  onRenamed,
}: {
  instanceId: string
  dir: string
  rel: string
  name: string
  onRenamed: () => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const trimmed = value.trim()
    if (!trimmed || trimmed === name) {
      setOpen(false)
      return
    }
    if (trimmed.includes("/")) {
      toast.error("Name cannot contain slashes.")
      return
    }
    setBusy(true)
    try {
      const r = await fetch(`/api/instances/${instanceId}/files`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "rename", path: rel, newPath: joinRel(dir, trimmed) }),
      })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) {
        toast.error(j.error || "Could not rename.")
        return
      }
      toast.success(`Renamed to "${trimmed}"`)
      setOpen(false)
      onRenamed()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setValue(name)
      }}
    >
      <Button size="icon-sm" variant="ghost" aria-label={`Rename ${name}`} onClick={() => setOpen(true)}>
        <span className="sr-only">Rename</span>
        <RefreshCw className="size-4 rotate-90" />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription>
            Rename <span className="font-mono text-foreground">{name}</span>.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="font-mono"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") submit()
          }}
        />
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={busy}>Cancel</Button>} />
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteButton({
  instanceId,
  rel,
  name,
  isDir,
  onDeleted,
}: {
  instanceId: string
  rel: string
  name: string
  isDir: boolean
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function doDelete() {
    setBusy(true)
    try {
      const qs = new URLSearchParams({ path: rel })
      if (isDir) qs.set("recursive", "true")
      const r = await fetch(`/api/instances/${instanceId}/files?${qs}`, { method: "DELETE" })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) {
        toast.error(j.error || "Could not delete.")
        return
      }
      toast.success(`Deleted ${name}`)
      onDeleted()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Delete ${name}`}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {isDir ? "folder" : "file"}?</AlertDialogTitle>
          <AlertDialogDescription>
            {isDir ? (
              <>
                Permanently deletes <span className="font-mono text-foreground">{name}</span> and
                everything inside it. This cannot be undone.
              </>
            ) : (
              <>
                Permanently deletes <span className="font-mono text-foreground">{name}</span>. This
                cannot be undone.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault()
              doDelete()
            }}
          >
            {busy ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function NewFolderButton({
  onCreate,
}: {
  onCreate: (name: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed.includes("/")) {
      toast.error("Folder name cannot contain slashes.")
      return
    }
    setBusy(true)
    try {
      const ok = await onCreate(trimmed)
      if (ok) {
        setOpen(false)
        setName("")
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setName("")
      }}
    >
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <FolderPlus data-icon="inline-start" />
        New folder
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>Create a folder in the current directory.</DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="folder name"
          className="font-mono"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") submit()
          }}
        />
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={busy}>Cancel</Button>} />
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
