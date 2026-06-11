import type { ComponentProps } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { getMonitoringSummary } from "@/lib/monitoring"
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

// Uptime Kuma health → badge tone.
const KUMA_VARIANT: Record<string, StatusVariant> = {
  up: "default",
  down: "destructive",
  pending: "secondary",
  maintenance: "outline",
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—"
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

  const [{ fleet, agents }, team] = await Promise.all([
    getMonitoringSummary(session.user.id),
    getUserTeam(session.user.id),
  ])
  const canManageAlerts = team?.role === "owner" || team?.role === "admin"

  const stats = [
    { label: "Total Agents", value: fleet.total.toString() },
    { label: "Running", value: fleet.running.toString(), accent: true },
    { label: "Incidents 24h", value: fleet.incidents24h.toString() },
    {
      label: "Avg Latency",
      value: fleet.avgLatencyMs != null ? `${fleet.avgLatencyMs} ms` : "—",
    },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Monitoring"
        description="Live uptime, health, latency, and spend across all your agents."
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} size="sm">
            <CardHeader>
              <CardDescription className="text-xs">{stat.label}</CardDescription>
              <CardTitle
                className={
                  stat.accent
                    ? "text-3xl font-bold text-primary"
                    : "text-3xl font-bold text-foreground"
                }
              >
                {stat.value}
              </CardTitle>
            </CardHeader>
          </Card>
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
                      <Badge variant={STATUS_VARIANT[a.status] ?? "outline"}>{a.status}</Badge>
                      {a.deploymentTarget === "vps" && (
                        <Badge variant="outline" className="ml-2">
                          {runtimeLabel(a.runtime)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {a.kumaStatus ? (
                        <Badge variant={KUMA_VARIANT[a.kumaStatus] ?? "outline"}>
                          {a.kumaStatus}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">not monitored</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {a.uptimeRatio24h != null ? `${(a.uptimeRatio24h * 100).toFixed(2)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {a.latencyMs != null ? `${a.latencyMs} ms` : "—"}
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
