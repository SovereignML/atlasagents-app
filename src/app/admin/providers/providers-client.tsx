"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import type { ProviderOverview } from "@/lib/provider-admin"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type RegionOption = { id: string; label: string; slug: string }

type LogRow = {
  id: string
  instanceId: string | null
  workloadType: string | null
  chosenProviderId: string | null
  score: number | null
  rejected: unknown
  outcome: string | null
  createdAt: string | Date
}

function healthVariant(status: string | undefined): "default" | "secondary" | "destructive" | "outline" {
  if (status === "up") return "default"
  if (status === "degraded") return "outline"
  if (status === "down") return "destructive"
  return "secondary"
}

function usd(n: number | null | undefined): string {
  if (n == null) return "-"
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

export function ProvidersClient({
  providers,
  regions,
  logs,
  providerNames,
}: {
  providers: ProviderOverview[]
  regions: RegionOption[]
  logs: LogRow[]
  providerNames: Record<string, string>
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function call(url: string, method: string, body?: unknown, label?: string) {
    setBusy(url)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`)
      toast.success(label ?? "Saved")
      router.refresh()
      return data
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {providers.length === 0 && (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              No providers configured yet. Run <code className="font-mono">npm run db:seed</code> to
              populate the registry, plans, regions, and budgets.
            </CardContent>
          </Card>
        )}

        {providers.map((p) => (
          <Card key={p.id}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CardTitle>{p.name}</CardTitle>
                <Badge variant="secondary" className="font-mono">
                  {p.slug}
                </Badge>
                <Badge variant={p.enabled ? "default" : "destructive"}>
                  {p.enabled ? "Enabled" : "Disabled"}
                </Badge>
                <Badge variant={healthVariant(p.health?.status)} className="font-mono">
                  {p.health ? p.health.status : "no probe"}
                  {p.health?.latencyMs != null ? ` · ${p.health.latencyMs}ms` : ""}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => call(`/api/admin/providers/${p.id}/health`, "POST", undefined, "Health checked")}
                >
                  Check health
                </Button>
                <Button
                  size="sm"
                  variant={p.enabled ? "outline" : "default"}
                  disabled={busy !== null}
                  onClick={() =>
                    call(
                      `/api/admin/providers/${p.id}`,
                      "PATCH",
                      { enabled: !p.enabled },
                      p.enabled ? "Provider disabled" : "Provider enabled",
                    )
                  }
                >
                  {p.enabled ? "Disable" : "Enable"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-3">
              {/* Routing stats */}
              <div className="space-y-1 text-sm">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Routing</p>
                <p>
                  Success rate:{" "}
                  <span className="font-mono">
                    {p.successRate != null ? `${(p.successRate * 100).toFixed(0)}%` : "-"}
                  </span>{" "}
                  <span className="text-xs text-muted-foreground">({p.provisioningSamples} samples)</span>
                </p>
                <p>
                  Budget remaining: <span className="font-mono">{usd(p.billing?.remainingUsd)}</span>
                </p>
                <p>
                  Compute burn:{" "}
                  <span className="font-mono">{usd(p.billing?.burnRateUsdPerDay)}/day</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Compute we bill against this provider — running agents + warm pool. Our
                  internal budget, not your live provider-account balance.
                </p>
              </div>

              {/* Priority + region pin */}
              <PriorityPinForm
                provider={p}
                regions={regions}
                busy={busy !== null}
                onSave={(body, label) => call(`/api/admin/providers/${p.id}`, "PATCH", body, label)}
              />

              {/* Budget */}
              <BudgetForm
                provider={p}
                busy={busy !== null}
                onSave={(body) =>
                  call(`/api/admin/providers/${p.id}/billing`, "PATCH", body, "Budget updated")
                }
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent routing decisions</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No routing decisions logged yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Workload</TableHead>
                  <TableHead>Chosen</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Rejected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => {
                  const rejected = Array.isArray(l.rejected) ? (l.rejected as Array<{ providerId: string; reason: string }>) : []
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">
                        {new Date(l.createdAt).toISOString().slice(5, 19).replace("T", " ")}
                      </TableCell>
                      <TableCell className="text-xs">{l.workloadType ?? "general"}</TableCell>
                      <TableCell className="text-xs">
                        {l.chosenProviderId ? providerNames[l.chosenProviderId] ?? l.chosenProviderId : "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {l.score != null ? l.score.toFixed(3) : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            l.outcome === "succeeded"
                              ? "default"
                              : l.outcome === "failed"
                                ? "destructive"
                                : "outline"
                          }
                          className="font-mono text-[10px]"
                        >
                          {l.outcome ?? "pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {rejected.length === 0
                          ? "-"
                          : rejected
                              .map((r) => `${providerNames[r.providerId] ?? r.providerId}: ${r.reason}`)
                              .join("; ")}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PriorityPinForm({
  provider,
  regions,
  busy,
  onSave,
}: {
  provider: ProviderOverview
  regions: RegionOption[]
  busy: boolean
  onSave: (body: Record<string, unknown>, label: string) => void
}) {
  const [priority, setPriority] = useState(String(provider.priority))
  const [pin, setPin] = useState(provider.pinnedRegionId ?? "")

  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Priority &amp; pin</p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="h-8 w-20"
          aria-label="Priority"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onSave({ priority: Number(priority) }, "Priority updated")}
        >
          Save
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="h-8 flex-1 rounded-md border bg-background px-2 text-xs"
          aria-label="Pin region"
        >
          <option value="">No pin</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            onSave({ pinnedRegionId: pin === "" ? null : pin }, pin === "" ? "Pin removed" : "Region pinned")
          }
        >
          Save
        </Button>
      </div>
    </div>
  )
}

function BudgetForm({
  provider,
  busy,
  onSave,
}: {
  provider: ProviderOverview
  busy: boolean
  onSave: (body: Record<string, number | null>) => void
}) {
  const [monthly, setMonthly] = useState(String(provider.billing?.monthlyCreditsUsd ?? 0))
  const [soft, setSoft] = useState(provider.billing?.softLimitUsd?.toString() ?? "")
  const [hard, setHard] = useState(provider.billing?.hardLimitUsd?.toString() ?? "")

  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Budget (USD)</p>
      <label className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Monthly</span>
        <Input type="number" min={0} value={monthly} onChange={(e) => setMonthly(e.target.value)} className="h-8 w-28" />
      </label>
      <label className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Soft limit</span>
        <Input type="number" min={0} value={soft} onChange={(e) => setSoft(e.target.value)} className="h-8 w-28" />
      </label>
      <label className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Hard limit</span>
        <Input type="number" min={0} value={hard} onChange={(e) => setHard(e.target.value)} className="h-8 w-28" />
      </label>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        className="w-full"
        onClick={() =>
          onSave({
            monthlyCreditsUsd: Number(monthly),
            softLimitUsd: soft === "" ? null : Number(soft),
            hardLimitUsd: hard === "" ? null : Number(hard),
          })
        }
      >
        Save budget
      </Button>
    </div>
  )
}
