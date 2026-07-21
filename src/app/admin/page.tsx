import Link from "next/link"

import { db, sql, isNull, instances, orphanEvents } from "@/db"
import { requireAdminPage } from "@/lib/admin-guard"
import { getProvidersOverview } from "@/lib/provider-admin"
import { getPoolHealth, type PoolHealth } from "@/lib/warm-pool"
import {
  getAccountHealth,
  getFleetHealth,
  type AccountRow,
  type FleetRow,
  type HealthCounts,
} from "@/lib/admin-accounts"
import { runtimeLabel } from "@/lib/runtimes/labels"
import { StatCard } from "@/components/admin/stat-card"
import { StatusBadge } from "@/components/admin/status-badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PageContainer, PageHeader, PageSection } from "@/components/layout/page-container"
import { DashboardTabs } from "./dashboard-tabs"

// How many rows the dashboard health tables show before "View all →".
const TABLE_ROWS = 25

// Pool health plus a flag set when the query itself failed (vs. a pool that
// is simply disabled in this env) — lets the card show "unavailable".
type PoolResult = PoolHealth & { unavailable?: boolean }

/** Compact "3d ago" / "4h ago" / "just now" / "never" formatter. */
function ago(date: Date | null | undefined): string {
  if (!date) return "never"
  const ms = Date.now() - date.getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default async function AdminDashboard() {
  await requireAdminPage()
  const [fleet, accounts, pool, providers, orphanRows, reconcileRows] = await Promise.all([
    getFleetHealth(),
    getAccountHealth(),
    // Degrade gracefully: a warm-pool health failure (e.g. the WarmVm table
    // not yet synced on a fresh deploy) must not take down the whole
    // dashboard. Fall back to an "unavailable" pool card instead.
    getPoolHealth().catch((err): PoolResult => {
      console.error("[admin-dashboard] warm-pool health unavailable:", err)
      return { enabled: false, entries: [], unavailable: true }
    }),
    getProvidersOverview(),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orphanEvents)
      .where(isNull(orphanEvents.resolvedAt)),
    db.select({ max: sql<Date | null>`max(${instances.reconciledAt})` }).from(instances),
  ])

  const openOrphans = Number(orphanRows[0]?.count ?? 0)
  const lastReconciled = reconcileRows[0]?.max ?? null

  const poolUnavailable = (pool as PoolResult).unavailable === true
  const poolReady = pool.entries.reduce((s, e) => s + e.ready, 0)
  const poolTarget = pool.entries.reduce((s, e) => s + e.target, 0)
  const poolFull = poolReady >= poolTarget

  const providerUp = providers.filter((p) => p.health?.status === "up").length
  const providerDown = providers.filter((p) => p.health?.status === "down").length
  const providerDegraded = providers.filter((p) => p.health?.status === "degraded").length

  return (
    <PageContainer>
      <PageHeader
        title="Admin Dashboard"
        description="Operational command center — fleet health, self-healing status, and accounts at a glance."
      />

      {/* ── Self-healing ops strip ── */}
      <PageSection title="Self-healing status">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Warm pool ready"
            value={
              poolUnavailable
                ? "unavailable"
                : pool.enabled
                  ? `${poolReady} / ${poolTarget}`
                  : "off"
            }
            tone={
              poolUnavailable
                ? "danger"
                : !pool.enabled
                  ? "muted"
                  : poolFull
                    ? "accent"
                    : "warning"
            }
            hint={
              poolUnavailable
                ? "pool health check failed — see server logs"
                : pool.enabled
                  ? "pre-baked VMs ready to claim"
                  : "pool disabled in this env"
            }
            href="/admin/instances?tab=pool"
          />
          <StatCard
            label="Provider health"
            value={`${providerUp} up`}
            tone={providerDown > 0 ? "danger" : providerDegraded > 0 ? "warning" : "positive"}
            hint={
              providerDown > 0
                ? `${providerDown} down · ${providerDegraded} degraded`
                : providerDegraded > 0
                  ? `${providerDegraded} degraded`
                  : "all providers healthy"
            }
            href="/admin/providers"
          />
          <StatCard
            label="Open orphans"
            value={openOrphans}
            tone={openOrphans > 0 ? "warning" : "positive"}
            hint="untracked VMs pending sweep"
            href="/admin/instances?tab=orphans"
          />
          <StatCard
            label="Last reconciled"
            value={ago(lastReconciled)}
            tone="muted"
            hint="most recent reconciler pass"
          />
        </div>
      </PageSection>

      {/* ── Tabbed health views ── */}
      <DashboardTabs
        fleet={<FleetTab counts={fleet.counts} rows={fleet.rows} />}
        accounts={<AccountsTab counts={accounts.counts} rows={accounts.rows} />}
      />
    </PageContainer>
  )
}

function HealthCards({ counts }: { counts: HealthCounts }) {
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      <StatCard label="Healthy" value={counts.healthy} tone="accent" />
      <StatCard label="At Risk" value={counts.at_risk} tone="warning" />
      <StatCard label="Churn Risk" value={counts.churn_risk} tone="danger" />
    </div>
  )
}

function FleetTab({ counts, rows }: { counts: HealthCounts; rows: FleetRow[] }) {
  const shown = rows.slice(0, TABLE_ROWS)
  return (
    <div className="space-y-6">
      <HealthCards counts={counts} />
      <PageSection
        title="Instance health"
        actions={
          <Link href="/admin/instances" className="text-sm font-medium text-primary hover:underline">
            View all &rarr;
          </Link>
        }
      >
        {shown.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No instances</EmptyTitle>
              <EmptyDescription>Instances appear here once provisioned.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Card className="overflow-hidden p-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instance</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead>Runtime</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead>Last Active</TableHead>
                    <TableHead className="text-right">Health</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <p className="font-medium text-foreground">{r.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{r.slug}</p>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.ownerEmail}</TableCell>
                      <TableCell className="text-muted-foreground">{r.serverLabel}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.deploymentTarget === "vps" ? runtimeLabel(r.runtime) : r.deploymentTarget}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {r.regionCode ?? "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{ago(r.lastActiveAt)}</TableCell>
                      <TableCell className="text-right">
                        <StatusBadge status={r.tier} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        {rows.length > shown.length && (
          <p className="text-xs text-muted-foreground">
            Showing {shown.length} of {rows.length} instances.
          </p>
        )}
      </PageSection>
    </div>
  )
}

function AccountsTab({ counts, rows }: { counts: HealthCounts; rows: AccountRow[] }) {
  const shown = rows.slice(0, TABLE_ROWS)
  return (
    <div className="space-y-6">
      <HealthCards counts={counts} />
      <PageSection
        title="Account health"
        actions={
          <Link href="/admin/teams" className="text-sm font-medium text-primary hover:underline">
            View all &rarr;
          </Link>
        }
      >
        {shown.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No accounts</EmptyTitle>
              <EmptyDescription>Teams appear here once created.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Card className="overflow-hidden p-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-center">Agents</TableHead>
                    <TableHead className="text-center">Members</TableHead>
                    <TableHead className="text-right">MRR</TableHead>
                    <TableHead>Last Active</TableHead>
                    <TableHead className="text-right">Health</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow key={r.teamId}>
                      <TableCell>
                        <p className="font-medium text-foreground">{r.name}</p>
                        <p className="text-xs text-muted-foreground">{r.ownerEmail}</p>
                      </TableCell>
                      <TableCell className="capitalize text-muted-foreground">
                        {r.planTier ?? "—"}
                      </TableCell>
                      <TableCell className="text-center text-foreground">{r.agents}</TableCell>
                      <TableCell className="text-center text-muted-foreground">{r.members}</TableCell>
                      <TableCell className="text-right font-medium text-foreground">
                        ${r.mrrUsd.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{ago(r.lastActiveAt)}</TableCell>
                      <TableCell className="text-right">
                        <StatusBadge status={r.tier} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        {rows.length > shown.length && (
          <p className="text-xs text-muted-foreground">
            Showing {shown.length} of {rows.length} accounts.
          </p>
        )}
      </PageSection>
    </div>
  )
}
