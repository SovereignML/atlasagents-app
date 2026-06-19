import type { ComponentProps } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { Activity, Boxes, Gauge, TriangleAlert } from "lucide-react"

import { auth } from "@/auth"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { StatCard } from "@/components/dashboard/stat-card"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AlertRules } from "@/components/dashboard/alert-rules"
import { AutoRefresh } from "@/components/dashboard/auto-refresh"
import { HeartbeatBar } from "@/components/dashboard/heartbeat-bar"
import { getMonitoringSummary } from "@/lib/monitoring"
import { maybeRunUptimeSync } from "@/lib/uptime-monitoring"
import { formatUsd } from "@/lib/pricing"
import { runtimeLabel } from "@/lib/runtimes/labels"
import { getUserTeam } from "@/lib/team"

type StatusVariant = ComponentProps<typeof Badge>["variant"]

const STATUS_VARIANT: Record<string, StatusVariant> = {
  running: "default",
  provisioning: "secondary",
  stopped: "secondary",
  failed: "destructive",
  deleted: "outline",
}

// Uptime Kuma health → low-opacity square tag tint (keeps per-status coloring).
const KUMA_TAG: Record<string, string> = {
  up: "bg-emerald-500/15 text-emerald-500",
  down: "bg-destructive/15 text-destructive",
  pending: "bg-amber-400/15 text-amber-400",
  maintenance: "bg-amber-400/15 text-amber-400",
}

function relativeTime(iso: string | null): string {
  if (!iso) return "-"
  const then = new Date(iso).getTime()
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export default async function MonitoringPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  // Best-effort: freshen the Kuma snapshot/history so the dashboard works even
  // with no cron wired. Throttled + bounded; never throws.
  await maybeRunUptimeSync()

  const [{ fleet, agents }, team] = await Promise.all([
    getMonitoringSummary(session.user.id),
    getUserTeam(session.user.id),
  ])
  const canManageAlerts = team?.role === "owner" || team?.role === "admin"

  const stats = [
    { label: "Total Agents", value: fleet.total.toString(), icon: Boxes, tone: "primary" as const },
    { label: "Running", value: fleet.running.toString(), icon: Activity, tone: "emerald" as const },
    {
      label: "Incidents 24h",
      value: fleet.incidents24h.toString(),
      icon: TriangleAlert,
      tone: fleet.incidents24h > 0 ? ("rose" as const) : ("primary" as const),
    },
    {
      label: "Avg Latency",
      value: fleet.avgLatencyMs != null ? `${fleet.avgLatencyMs} ms` : "-",
      icon: Gauge,
      tone: "sky" as const,
    },
  ]

  return (
    <PageContainer>
      <AutoRefresh />
      <PageHeader
        title="Monitoring"
        description="Live uptime, health, latency, and spend across all your agents."
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            icon={stat.icon}
            tone={stat.tone}
            glow
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardDescription className="text-sm font-medium">Per-agent status</CardDescription>
        </CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No agents deployed yet.{" "}
              <Link href="/dashboard/deploy" className="text-primary hover:underline">
                Deploy one
              </Link>
              .
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead className="text-right">Uptime 24h</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Runs 24h</TableHead>
                  <TableHead className="text-right">Last Check</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/instances/${a.id}?tab=monitoring`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {a.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">{a.slug}</p>
                    </TableCell>
                    <TableCell>
                      {a.status === "running" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-[5px] rounded-full bg-emerald-500" />
                          <Badge variant="default">running</Badge>
                        </span>
                      ) : (
                        <Badge variant={STATUS_VARIANT[a.status] ?? "outline"}>{a.status}</Badge>
                      )}
                      {a.deploymentTarget === "vps" && (
                        <Badge variant="outline" className="ml-2 font-mono text-[10px]">
                          {runtimeLabel(a.runtime)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {a.kumaStatus || a.samples.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                          {a.kumaStatus && (
                            <span
                              className={`inline-flex w-fit items-center rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] ${
                                KUMA_TAG[a.kumaStatus] ?? "bg-muted text-muted-foreground"
                              }`}
                            >
                              {a.kumaStatus}
                            </span>
                          )}
                          {a.samples.length > 0 && (
                            <HeartbeatBar samples={a.samples} size="sm" count={12} />
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">not monitored</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {a.uptimeRatio24h != null ? `${(a.uptimeRatio24h * 100).toFixed(2)}%` : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {a.latencyMs != null ? `${a.latencyMs} ms` : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatUsd(a.costUsd)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{a.runs24h}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {relativeTime(a.lastCheckAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription className="text-sm font-medium">Alert rules</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertRules
            agents={agents.map((a) => ({ id: a.id, name: a.name }))}
            canManage={canManageAlerts}
          />
        </CardContent>
      </Card>
    </PageContainer>
  )
}
