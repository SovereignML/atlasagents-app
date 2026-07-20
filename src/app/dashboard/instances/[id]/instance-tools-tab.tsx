"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Globe, Search, Terminal, Image as ImageIcon, Plug } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { AgentTool } from "@/configs/agent-tools"
import { KnowledgeManager } from "./instance-knowledge-manager"

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Globe,
  Search,
  Terminal,
  Image: ImageIcon,
  Plug,
}

const RUNTIME_LABEL: Record<string, string> = {
  openclaw: "OpenClaw",
  hermes: "Hermes",
}

type ToolsResponse = {
  enabledTools: string[]
  catalog: AgentTool[]
  runtime: string
}

export function ToolsTab({
  instanceId,
  runtime,
  status,
}: {
  instanceId: string
  runtime: string | null
  status: string
}) {
  const router = useRouter()
  const [catalog, setCatalog] = useState<AgentTool[]>([])
  const [enabled, setEnabled] = useState<Set<string>>(new Set())
  const [initial, setInitial] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const runtimeId = runtime ?? ""
  const runtimeLabel = RUNTIME_LABEL[runtimeId] ?? runtimeId

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/instances/${instanceId}/tools`, { cache: "no-store" })
        if (!r.ok || cancelled) return
        const data: ToolsResponse = await r.json()
        if (cancelled) return
        setCatalog(data.catalog)
        setEnabled(new Set(data.enabledTools))
        setInitial(data.enabledTools)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [instanceId])

  const isDirty = useMemo(() => {
    if (enabled.size !== initial.length) return true
    return initial.some((id) => !enabled.has(id))
  }, [enabled, initial])

  function supportedHere(tool: AgentTool): boolean {
    return runtimeId === "openclaw" || runtimeId === "hermes"
      ? tool.support[runtimeId] != null
      : false
  }

  function toggle(tool: AgentTool) {
    if (tool.comingSoon || !supportedHere(tool)) return
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(tool.id)) next.delete(tool.id)
      else next.add(tool.id)
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      const ids = catalog.filter((t) => enabled.has(t.id)).map((t) => t.id)
      const r = await fetch(`/api/instances/${instanceId}/tools`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledTools: ids }),
      })
      const j = await r.json()
      if (!r.ok) {
        toast.error(j.error || "Failed to update tools")
        return
      }
      setInitial(ids)
      setEnabled(new Set(ids))
      if (j.warning) toast.warning(j.warning)
      else if (status === "running")
        toast.success("Tools updated. Installing dependencies and restarting the agent…")
      else toast.success("Tools updated. They'll apply when the agent is deployed.")
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading tools…</p>
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-[10px] tracking-[0.1em] uppercase text-muted-foreground">
          Agent Tools
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Install capabilities into this agent. Changes are applied live; the agent restarts to
          pick them up.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {catalog.map((tool) => {
          const Icon = ICONS[tool.icon] ?? Plug
          const supported = supportedHere(tool)
          const on = enabled.has(tool.id)
          const disabled = tool.comingSoon || !supported
          return (
            <Card
              key={tool.id}
              data-active={on}
              className={cn(
                "transition-colors",
                on && "border-primary/40 bg-primary/[0.06]",
                disabled && "opacity-70"
              )}
            >
              <CardContent className="flex items-start gap-3 p-4">
                <div
                  className={cn(
                    "mt-0.5 rounded-md border p-2",
                    on
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground"
                  )}
                >
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{tool.name}</p>
                    {tool.comingSoon && (
                      <Badge variant="secondary" className="text-[10px]">
                        Coming soon
                      </Badge>
                    )}
                    {!tool.comingSoon && !supported && (
                      <Badge variant="outline" className="text-[10px]">
                        Not on {runtimeLabel}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>
                  {tool.requiresChromium && supported && !tool.comingSoon && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Installs a browser on your server (~400&nbsp;MB; first enable takes a minute).
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant={on ? "outline" : "default"}
                    className="mt-3"
                    disabled={disabled}
                    onClick={() => toggle(tool)}
                  >
                    {on ? "Enabled" : "Enable"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {isDirty && (
        <Button onClick={save} disabled={saving}>
          {saving ? "Applying…" : "Save & Apply"}
        </Button>
      )}

      {/* Knowledge Base sources — shown once the KB tool is saved/enabled. */}
      {initial.includes("knowledge_base") && <KnowledgeManager instanceId={instanceId} />}
    </div>
  )
}
