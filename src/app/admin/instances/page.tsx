import Link from "next/link"

import { db, desc, instances, orphanEvents, sql } from "@/db"
import { requireAdminPage } from "@/lib/admin-guard"
import { runtimeLabel } from "@/lib/runtimes/labels"
import {
  getPoolHealth,
  listRecentBakeFailures,
  listWarmVms,
  type BakeFailureRecord,
  type PoolHealthEntry,
} from "@/lib/warm-pool"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { StatusBadge } from "@/components/admin/status-badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { DestroyWarmVmButton } from "./pool-actions"

const TABS = [
  { id: "active", label: "Active" },
  { id: "pool", label: "Pre-Baked VMs" },
  { id: "deleted", label: "Deleted" },
  { id: "failed", label: "Failed" },
  { id: "orphans", label: "Orphans" },
] as const
type Tab = (typeof TABS)[number]["id"]

function parseTab(s: string | undefined): Tab {
  return (TABS.find((t) => t.id === s)?.id ?? "active") as Tab
}

/** Age of a timestamp as a compact "3d" / "4h" / "12m" / "just now" string. */
function ago(date: Date | string | null | undefined): string {
  if (!date) return "-"
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return "-"
  const ms = Date.now() - d.getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default async function AdminInstancesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  await requireAdminPage()
  const { tab } = await searchParams
  const active = parseTab(tab)

  const usesInstances = active === "active" || active === "deleted" || active === "failed"
  const whereByTab = {
    active: sql`${instances.status} NOT IN ('deleted', 'failed_provisioning')`,
    deleted: sql`${instances.status} = 'deleted'`,
    failed: sql`${instances.status} = 'failed_provisioning'`,
  } as const

  const rows = usesInstances
    ? await db.query.instances.findMany({
        where: whereByTab[active as "active" | "deleted" | "failed"],
        with: { user: true, region: true, serverConfig: true },
        orderBy:
          active === "deleted"
            ? [desc(instances.lastTransitionAt), desc(instances.createdAt)]
            : desc(instances.createdAt),
      })
    : []

  const orphans =
    active === "orphans"
      ? await db
          .select()
          .from(orphanEvents)
          .orderBy(desc(orphanEvents.detectedAt))
          .limit(200)
      : []

  const poolHealth = active === "pool" ? await getPoolHealth() : null
  const warmVmRows = active === "pool" ? await listWarmVms() : []
  // Failed rows are destroyed in the same refill pass that marks them, so the
  // live rows below can never show a failure. These come from OrphanEvent and
  // are the only view that makes a churning pool visible in the UI.
  const bakeFailures = active === "pool" ? await listRecentBakeFailures(20) : []

  return (
    <PageContainer>
      <PageHeader
        title="Admin · Instances"
        description="All agent instances across users, plus the pre-baked VM pool. Deleted rows and orphan events stay here for audit."
      />

      <div className="flex items-end gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`?tab=${t.id}`}
            className={`-mb-px border-b-2 px-4 py-2 text-xs uppercase tracking-wide transition-colors ${
              active === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-1">
          <Button
            variant="outline"
            size="sm"
            render={<a href="/api/admin/deleted-ips/export">Export IPs (CSV)</a>}
          />
          <form
            action={active === "pool" ? "/api/internal/pool-refill" : "/api/admin/reconcile"}
            method="POST"
          >
            <Button type="submit" variant="outline" size="sm">
              {active === "pool" ? "Refill pool" : "Run reconciler"}
            </Button>
          </form>
        </div>
      </div>

      {/* ── Instance tabs (active / deleted / failed) ── */}
      {usesInstances && rows.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing to show</EmptyTitle>
            <EmptyDescription>No instances match this filter.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {usesInstances && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((instance) => (
            <Card key={instance.id}>
              <CardContent className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="truncate font-medium text-foreground">{instance.name}</h3>
                    <StatusBadge status={instance.status} mono />
                    {instance.deploymentTarget === "vps" && (
                      <Badge variant="outline" className="font-mono">
                        {runtimeLabel(instance.runtime)}
                      </Badge>
                    )}
                    {instance.vmId && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        vm#{instance.vmId}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{instance.user.email}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {instance.slug} ·{" "}
                    {instance.ipAddress ||
                      (instance.deletedIpAddress
                        ? `${instance.deletedIpAddress} (released)`
                        : "no IP")}
                    {instance.domain && ` · ${instance.domain}`}
                  </p>
                  {active === "deleted" && (
                    <p className="mt-2 font-mono text-xs text-muted-foreground">
                      Deleted:{" "}
                      {(instance.deletedAt ?? instance.lastTransitionAt)?.toISOString().slice(0, 19) ??
                        "-"}{" "}
                      UTC
                      {instance.lastActiveAt && (
                        <>
                          {" "}
                          · Last active: {instance.lastActiveAt.toISOString().slice(0, 19)} UTC
                        </>
                      )}
                    </p>
                  )}
                  {instance.lastError && (
                    <p className="mt-1 font-mono text-xs text-destructive">
                      lastError: {instance.lastError}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right text-sm">
                  <p className="text-muted-foreground">
                    {instance.serverConfig.label} · {instance.serverConfig.vcpu} vCPU ·{" "}
                    {instance.serverConfig.ramGb} GB
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {instance.createdAt.toISOString().slice(0, 10)}
                  </p>
                  {(instance.status === "failed_provisioning" ||
                    instance.status === "deleting") && (
                    <ForceDeleteForm instanceId={instance.id} />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Pre-Baked VMs (warm pool) ── */}
      {active === "pool" && poolHealth && (
        <PoolTab health={poolHealth} rows={warmVmRows} bakeFailures={bakeFailures} />
      )}

      {/* ── Orphans ── */}
      {active === "orphans" && (
        <div className="space-y-2">
          {orphans.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No orphan events recorded</EmptyTitle>
                <EmptyDescription>
                  Orphan events from the reconciler will appear here when detected.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {orphans.map((o) => (
            <Card key={o.id} size="sm">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle className="font-mono text-sm">
                    vm#{o.vmId}
                    {o.ipAddress && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        {o.ipAddress} (released)
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription className="truncate text-xs">
                    {o.detail ?? ""}
                  </CardDescription>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs uppercase text-foreground">{o.action}</p>
                  <p className="text-[10px] text-muted-foreground">
                    detected {o.detectedAt.toISOString().slice(0, 19)}
                  </p>
                  {o.resolvedAt && (
                    <p className="text-[10px] text-primary">
                      resolved {o.resolvedAt.toISOString().slice(0, 19)}
                    </p>
                  )}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </PageContainer>
  )
}

function PoolTab({
  health,
  rows,
  bakeFailures,
}: {
  health: { enabled: boolean; entries: PoolHealthEntry[] }
  rows: Array<Awaited<ReturnType<typeof listWarmVms>>[number]>
  bakeFailures: BakeFailureRecord[]
}) {
  return (
    <div className="space-y-6">
      {!health.enabled && (
        <Card size="sm" className="border-amber-500/40">
          <CardContent className="text-sm text-muted-foreground">
            The warm pool is <strong>disabled</strong> in this environment (needs a provider token +
            fleet SSH key, and <span className="font-mono">POOL_ENABLED</span> not set to{" "}
            <span className="font-mono">false</span>). Existing rows are shown for reference; no VMs
            are created or refilled.
          </CardContent>
        </Card>
      )}

      {/* Fill summary per pool target */}
      {health.entries.length === 0 ? (
        <Card size="sm">
          <CardContent className="text-sm text-muted-foreground">
            No pool targets configured (all sizes are 0).
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {health.entries.map((e) => {
            const pct = e.target > 0 ? Math.min(100, Math.round((e.ready / e.target) * 100)) : 0
            const full = e.ready >= e.target
            return (
              <Card key={e.poolKey} size="sm">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm">
                      {runtimeLabel(e.runtime)}
                      {e.webuiEnabled && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">+ WebUI</span>
                      )}
                    </CardTitle>
                    <span
                      className={`text-sm font-bold ${full ? "text-primary" : "text-amber-600 dark:text-amber-400"}`}
                    >
                      {e.ready} / {e.target}
                    </span>
                  </div>
                  <CardDescription className="font-mono text-[10px]">
                    {e.regionCode} · {e.planCode}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Progress
                    value={pct}
                    indicatorClassName={full ? "bg-primary" : "bg-amber-500"}
                  />
                  <p className="text-xs text-muted-foreground">
                    {e.inFlight} in-flight · {e.claimed} claimed
                    {e.failed > 0 && (
                      <span className="text-destructive"> · {e.failed} failed</span>
                    )}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Recent bake failures. Deliberately ABOVE the live rows: when the pool
          is churning, the live rows look healthy (a few VMs mid-bake) and this
          is the only thing on the page that says otherwise. */}
      {bakeFailures.length > 0 && (
        <Card size="sm" className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-sm text-destructive">
              Recent bake failures ({bakeFailures.length})
            </CardTitle>
            <CardDescription>
              Each one is a VM that was created, billed, and destroyed without ever becoming
              usable. A steady stream here means the pool is looping — deploys are silently
              falling back to cold provisioning, and creates pause automatically once a pool key
              trips the breaker. The failing bootstrap step is named at the end of each entry.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {bakeFailures.map((f) => (
              <details key={f.id} className="rounded border border-border/60 p-2">
                <summary className="cursor-pointer font-mono text-xs text-muted-foreground">
                  {ago(f.detectedAt)} · vm#{f.vmId}
                  {f.ipAddress && ` · ${f.ipAddress}`}
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">
                  {f.detail}
                </pre>
              </details>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Warm-VM rows */}
      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No pre-baked VMs</EmptyTitle>
            <EmptyDescription>
              The pool has no VMs yet. When enabled it refills automatically; use “Refill pool” to
              trigger a pass now.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-3">
          {rows.map((vm) => (
            <Card key={vm.id} size="sm">
              <CardContent className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={vm.status} mono />
                    <Badge variant="outline" className="font-mono">
                      {runtimeLabel(vm.runtime)}
                    </Badge>
                    {vm.webuiEnabled && (
                      <span className="text-[10px] text-muted-foreground">+ WebUI</span>
                    )}
                    {vm.vmId && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        vm#{vm.vmId}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {vm.poolKey}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {vm.ipAddress || "no IP"}
                    {vm.managedSubdomain && ` · ${vm.managedSubdomain}`}
                  </p>
                  {vm.lastError && (
                    <p className="mt-1 font-mono text-xs text-destructive">
                      lastError: {vm.lastError}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-right text-xs text-muted-foreground">
                  <div>
                    <p>created {ago(vm.createdAt)}</p>
                    {vm.readyAt && <p>ready {ago(vm.readyAt)}</p>}
                    {vm.claimedAt && <p>claimed {ago(vm.claimedAt)}</p>}
                  </div>
                  <DestroyWarmVmButton
                    warmVmId={vm.id}
                    poolKey={vm.poolKey}
                    status={vm.status}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function ForceDeleteForm({ instanceId }: { instanceId: string }) {
  return (
    <form action={`/api/instances/${instanceId}/delete`} method="POST" className="mt-2">
      <Button type="submit" variant="outline" size="sm" className="text-destructive">
        Force delete
      </Button>
    </form>
  )
}
