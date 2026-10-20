"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Pencil, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * The agent's name as the page heading, with an inline rename for managers.
 * Deploys are named automatically; this is where a customer changes it. Only
 * the display name changes (PATCH /api/instances/<id>), never the URL.
 */
export function AgentName({
  instanceId,
  name,
  canRename,
}: {
  instanceId: string
  name: string
  canRename: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [saving, setSaving] = useState(false)

  async function save() {
    const next = draft.trim()
    if (!next || next === name) {
      setEditing(false)
      setDraft(name)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/instances/${instanceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || `Rename failed (${res.status})`)
        return
      }
      setEditing(false)
      toast.success("Agent renamed")
      router.refresh()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <h1 className="text-[34px] font-semibold tracking-tight">{name}</h1>
        {canRename && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setDraft(name)
              setEditing(true)
            }}
            aria-label="Rename agent"
            title="Rename"
          >
            <Pencil className="size-4" />
          </Button>
        )}
      </div>
    )
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={60}
        autoFocus
        aria-label="Agent name"
        className="h-11 w-72 text-lg font-semibold"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setEditing(false)
            setDraft(name)
          }
        }}
      />
      <Button type="submit" size="icon" disabled={saving || !draft.trim()} aria-label="Save name">
        <Check className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={saving}
        onClick={() => {
          setEditing(false)
          setDraft(name)
        }}
        aria-label="Cancel rename"
      >
        <X className="size-4" />
      </Button>
    </form>
  )
}
