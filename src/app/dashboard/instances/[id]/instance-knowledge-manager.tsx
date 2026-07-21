"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { BookOpen, FileText, Globe, Trash2, Plus } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"

type KnowledgeItem = {
  id: string
  type: "url" | "file"
  name: string
  sourceUrl: string | null
  sizeBytes: number | null
  createdAt: string
}

type Mode = "url" | "text"

/** Manage the agent's Knowledge Base sources (the `knowledge_base` tool). */
export function KnowledgeManager({ instanceId }: { instanceId: string }) {
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>("url")
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const r = await fetch(`/api/instances/${instanceId}/knowledge`, { cache: "no-store" })
      if (!r.ok) return
      const data = await r.json()
      setItems(data.items ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  async function add() {
    setBusy(true)
    try {
      const payload =
        mode === "url"
          ? { type: "url", sourceUrl: url.trim(), name: name.trim() || undefined }
          : { type: "file", name: name.trim(), textContent: text }
      const r = await fetch(`/api/instances/${instanceId}/knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const j = await r.json()
      if (!r.ok) {
        toast.error(j.error || "Failed to add source")
        return
      }
      toast.success("Source added.")
      setUrl("")
      setName("")
      setText("")
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    const r = await fetch(`/api/instances/${instanceId}/knowledge?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      toast.error(j.error || "Failed to remove source")
      return
    }
    toast.success("Source removed.")
    await load()
  }

  const canAdd =
    mode === "url" ? /^https?:\/\//i.test(url.trim()) : name.trim().length > 0 && text.trim().length > 0

  return (
    <Card className="border-primary/20">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-primary" />
          <p className="font-mono text-[10px] tracking-[0.1em] uppercase text-muted-foreground">
            Knowledge Base
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Add documents and URLs the agent consults (and cites) when answering. Sources sync to the
          live agent automatically.
        </p>

        {/* Add source */}
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === "url" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setMode("url")}
            >
              <Globe className="mr-1 size-3.5" /> URL
            </Button>
            <Button
              size="sm"
              variant={mode === "text" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setMode("text")}
            >
              <FileText className="mr-1 size-3.5" /> Text
            </Button>
          </div>

          {mode === "url" ? (
            <div className="space-y-2">
              <Input
                placeholder="https://example.com/docs/faq"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Input
                placeholder="Optional label (defaults to the URL)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                placeholder="Source name (e.g. Return policy)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Textarea
                placeholder="Paste the document text…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
              />
            </div>
          )}

          <Button size="sm" onClick={add} disabled={!canAdd || busy}>
            <Plus className="mr-1 size-3.5" />
            {busy ? "Adding…" : "Add source"}
          </Button>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading sources…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sources yet.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-center gap-3 rounded-md border border-border p-2.5"
              >
                {it.type === "url" ? (
                  <Globe className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{it.name}</p>
                  {it.sourceUrl && (
                    <p className="truncate text-[11px] text-muted-foreground">{it.sourceUrl}</p>
                  )}
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {it.type}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(it.id)}
                  aria-label="Remove source"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
