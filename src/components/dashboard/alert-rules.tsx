"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Rule = {
  id: string
  instanceId: string | null
  metric: string
  comparator: string
  threshold: number
  windowMinutes: number
  cooldownMinutes: number
  enabled: boolean
}

type AgentOption = { id: string; name: string }

const METRICS: { value: string; label: string; defaultComparator: "gt" | "lt" }[] = [
  { value: "down", label: "Agent is down", defaultComparator: "gt" },
  { value: "latency_ms", label: "Latency (ms)", defaultComparator: "gt" },
  { value: "uptime_ratio", label: "Uptime ratio (0–1)", defaultComparator: "lt" },
  { value: "cost_usd_period", label: "Spend (USD)", defaultComparator: "gt" },
  { value: "error_rate", label: "Error rate (0–1)", defaultComparator: "gt" },
]

const selectClass =
  "h-9 rounded-none border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"

function describe(r: Rule, agents: AgentOption[]): string {
  const scope = r.instanceId
    ? (agents.find((a) => a.id === r.instanceId)?.name ?? "one agent")
    : "all team agents"
  const metric = METRICS.find((m) => m.value === r.metric)?.label ?? r.metric
  if (r.metric === "down") return `${scope}: agent is down`
  return `${scope}: ${metric} ${r.comparator === "gt" ? ">" : "<"} ${r.threshold}`
}

export function AlertRules({
  agents,
  canManage,
}: {
  agents: AgentOption[]
  canManage: boolean
}) {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Create-form state
  const [metric, setMetric] = useState("down")
  const [comparator, setComparator] = useState<"gt" | "lt">("gt")
  const [threshold, setThreshold] = useState("0")
  const [instanceId, setInstanceId] = useState("")

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/monitoring/alerts")
      const data = await res.json()
      setRules(data.rules ?? [])
    } catch {
      toast.error("Failed to load alert rules")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function onMetricChange(value: string) {
    setMetric(value)
    const m = METRICS.find((x) => x.value === value)
    if (m) setComparator(m.defaultComparator)
  }

  async function create() {
    setSaving(true)
    try {
      const res = await fetch("/api/monitoring/alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          metric,
          comparator,
          threshold: Number(threshold) || 0,
          instanceId: instanceId || undefined,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error ?? "Failed")
      }
      toast.success("Alert rule created")
      setThreshold("0")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create rule")
    } finally {
      setSaving(false)
    }
  }

  async function toggle(rule: Rule) {
    try {
      const res = await fetch(`/api/monitoring/alerts/${rule.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch {
      toast.error("Failed to update rule")
    }
  }

  async function remove(rule: Rule) {
    try {
      const res = await fetch(`/api/monitoring/alerts/${rule.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("Alert rule deleted")
      await load()
    } catch {
      toast.error("Failed to delete rule")
    }
  }

  const showThreshold = metric !== "down"

  return (
    <div className="space-y-4">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading rules…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No alert rules yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{describe(r, agents)}</p>
                <p className="text-xs text-muted-foreground">
                  window {r.windowMinutes}m · cooldown {r.cooldownMinutes}m
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={r.enabled ? "default" : "outline"}>
                  {r.enabled ? "enabled" : "disabled"}
                </Badge>
                {canManage && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => toggle(r)}>
                      {r.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => remove(r)}>
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <select
            aria-label="Metric"
            className={selectClass}
            value={metric}
            onChange={(e) => onMetricChange(e.target.value)}
          >
            {METRICS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          {showThreshold && (
            <>
              <select
                aria-label="Comparator"
                className={selectClass}
                value={comparator}
                onChange={(e) => setComparator(e.target.value as "gt" | "lt")}
              >
                <option value="gt">greater than</option>
                <option value="lt">less than</option>
              </select>
              <Input
                aria-label="Threshold"
                type="number"
                step="any"
                className="w-28"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </>
          )}

          <select
            aria-label="Scope"
            className={selectClass}
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
          >
            <option value="">All team agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <Button size="sm" onClick={create} disabled={saving}>
            {saving ? "Adding…" : "Add rule"}
          </Button>
        </div>
      )}
    </div>
  )
}
