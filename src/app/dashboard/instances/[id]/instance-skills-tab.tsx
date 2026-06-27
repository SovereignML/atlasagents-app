"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  BookOpen,
  Inbox,
  Filter,
  Send,
  Calendar,
  Search,
  PenLine,
  MessageCircle,
  FileText,
  Sparkles,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { getTool } from "@/configs/agent-tools"
import type { AgentSkill } from "@/configs/agent-skills"

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  BookOpen,
  Inbox,
  Filter,
  Send,
  Calendar,
  Search,
  PenLine,
  MessageCircle,
  FileText,
}

type SkillsResponse = {
  enabledSkills: string[]
  catalog: AgentSkill[]
  enabledTools: string[]
}

/** Human-readable names for the tools a skill auto-enables. */
function requiredToolNames(skill: AgentSkill): string[] {
  return (skill.requiredTools ?? [])
    .map((id) => getTool(id)?.name)
    .filter((n): n is string => !!n)
}

export function SkillsTab({
  instanceId,
  status,
}: {
  instanceId: string
  runtime: string | null
  status: string
}) {
  const router = useRouter()
  const [catalog, setCatalog] = useState<AgentSkill[]>([])
  const [enabled, setEnabled] = useState<Set<string>>(new Set())
  const [initial, setInitial] = useState<string[]>([])
  const [enabledTools, setEnabledTools] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/instances/${instanceId}/skills`, { cache: "no-store" })
        if (!r.ok || cancelled) return
        const data: SkillsResponse = await r.json()
        if (cancelled) return
        setCatalog(data.catalog)
        setEnabled(new Set(data.enabledSkills))
        setInitial(data.enabledSkills)
        setEnabledTools(new Set(data.enabledTools))
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

  function toggle(skill: AgentSkill) {
    if (skill.comingSoon) return
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(skill.id)) next.delete(skill.id)
      else next.add(skill.id)
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      const ids = catalog.filter((s) => enabled.has(s.id)).map((s) => s.id)
      const r = await fetch(`/api/instances/${instanceId}/skills`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledSkills: ids }),
      })
      const j = await r.json()
      if (!r.ok) {
        toast.error(j.error || "Failed to update skills")
        return
      }
      setInitial(ids)
      setEnabled(new Set(ids))
      if (Array.isArray(j.enabledTools)) setEnabledTools(new Set(j.enabledTools))
      if (j.warning) toast.warning(j.warning)
      else if (Array.isArray(j.autoEnabledTools) && j.autoEnabledTools.length)
        toast.success(`Skills updated. Auto-enabled ${j.autoEnabledTools.length} tool(s).`)
      else if (status === "running") toast.success("Skills updated. Restarting the agent…")
      else toast.success("Skills updated. They'll apply when the agent is deployed.")
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading skills…</p>
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-[10px] tracking-[0.1em] uppercase text-muted-foreground">
          Agent Skills
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Job playbooks that shape how this agent works. Enabling a skill that needs a tool turns
          that tool on automatically.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {catalog.map((skill) => {
          const Icon = ICONS[skill.icon] ?? Sparkles
          const on = enabled.has(skill.id)
          const disabled = !!skill.comingSoon
          const toolNames = requiredToolNames(skill)
          const missingTools = (skill.requiredTools ?? []).filter((t) => !enabledTools.has(t))
          return (
            <Card
              key={skill.id}
              data-active={on}
              className={cn(
                "transition-colors",
                on && "border-primary/40 bg-primary/[0.06]",
                disabled && "opacity-70",
              )}
            >
              <CardContent className="flex items-start gap-3 p-4">
                <div
                  className={cn(
                    "mt-0.5 rounded-md border p-2",
                    on
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{skill.name}</p>
                    {skill.comingSoon && (
                      <Badge variant="secondary" className="text-[10px]">
                        Coming soon
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
                  {toolNames.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Needs: {toolNames.join(", ")}
                      {on && missingTools.length > 0 && (
                        <span className="text-primary"> · will be enabled on save</span>
                      )}
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant={on ? "outline" : "default"}
                    className="mt-3"
                    disabled={disabled}
                    onClick={() => toggle(skill)}
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
    </div>
  )
}
