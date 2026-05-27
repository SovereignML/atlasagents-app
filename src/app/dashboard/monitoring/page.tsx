import type { ComponentProps } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { TriangleAlert } from "lucide-react"

import { auth } from "@/auth"
import { db } from "@/db"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { whereUserInstancesVisible } from "@/lib/instance-queries"
import { runtimeLabel } from "@/lib/runtimes/labels"

type StatusVariant = ComponentProps<typeof Badge>["variant"]

const STATUS_VARIANT: Record<string, StatusVariant> = {
  running: "default",
  provisioning: "secondary",
  stopped: "secondary",
  failed: "destructive",
  deleted: "outline",
}

export default async function MonitoringPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const visibleInstances = await db.query.instances.findMany({
    where: whereUserInstancesVisible(session.user.id),
    orderBy: (t, { desc }) => desc(t.createdAt),
  })

  const stats = [
    { label: "Total Agents", value: visibleInstances.length.toString() },
    {
      label: "Running",
      value: visibleInstances.filter((i) => i.status === "running").length.toString(),
      accent: true,
    },
    { label: "Incidents 24h", value: "0" },
    { label: "Avg Latency", value: "142 ms" },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Monitoring"
        description="Uptime, health, and latency across all your agents. Powered by Uptime Kuma (API integration pending)."
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
          {visibleInstances.length === 0 ? (
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
                  <TableHead className="text-right">Uptime 24h</TableHead>
                  <TableHead className="text-right">Uptime 7d</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead className="text-right">Last Check</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleInstances.map((i, idx) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/instances/${i.id}?tab=monitoring`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {i.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">{i.slug}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[i.status] ?? "outline"}>{i.status}</Badge>
                      {i.deploymentTarget === "vps" && (
                        <Badge variant="outline" className="ml-2">{runtimeLabel(i.runtime)}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {i.status === "running" ? `${(99.8 - idx * 0.1).toFixed(2)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {i.status === "running" ? `${(99.6 - idx * 0.1).toFixed(2)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {i.status === "running" ? `${140 + idx * 5} ms` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {i.status === "running" ? `${10 + idx * 2}s ago` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Alert className="mt-4">
            <TriangleAlert />
            <AlertDescription>
              Uptime and latency values are placeholders — Uptime Kuma API integration pending.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription className="text-sm font-medium">Kuma Integration</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Health probes will run against each bot&apos;s gateway URL every 60 seconds.
            Uptime Kuma stores the raw history; this dashboard reads it through{" "}
            <code className="rounded border bg-muted px-1.5 py-0.5 font-mono text-primary">
              GET /api/monitoring/summary
            </code>{" "}
            (not yet implemented). Custom alerts, status pages, and SLA reports will follow.
          </p>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
