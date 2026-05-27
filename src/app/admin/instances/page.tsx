import Link from "next/link"

import { db, desc, instances, orphanEvents, sql } from "@/db"
import { Badge } from "@/components/ui/badge"
import { runtimeLabel } from "@/lib/runtimes/labels"
import { Button } from "@/components/ui/button"
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

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running":
      return "default"
    case "failed":
    case "failed_provisioning":
      return "destructive"
    case "provisioning":
    case "pending":
      return "outline"
    default:
      return "secondary"
  }
}

const TABS = [
  { id: "active", label: "Active" },
  { id: "deleted", label: "Deleted" },
  { id: "failed", label: "Failed" },
  { id: "orphans", label: "Orphans" },
] as const
type Tab = (typeof TABS)[number]["id"]

function parseTab(s: string | undefined): Tab {
  return (TABS.find((t) => t.id === s)?.id ?? "active") as Tab
}

export default async function AdminInstancesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const active = parseTab(tab)

  const whereByTab = {
    active: sql`${instances.status} NOT IN ('deleted', 'failed_provisioning')`,
    deleted: sql`${instances.status} = 'deleted'`,
    failed: sql`${instances.status} = 'failed_provisioning'`,
    orphans: sql`1 = 0`,
  }[active]

  const rows =
    active === "orphans"
      ? []
      : await db.query.instances.findMany({
          where: whereByTab,
          with: { user: true, region: true, serverConfig: true },
          orderBy:
            active === "deleted"
              ? [desc(instances.lastTransitionAt), desc(instances.createdAt)]
              : desc(instances.createdAt),
        })

  const orphans =
    active === "orphans"
      ? await db
          .select()
          .from(orphanEvents)
          .orderBy(desc(orphanEvents.detectedAt))
          .limit(200)
      : []

  return (
    <PageContainer>
      <PageHeader
        title="Admin · Instances"
        description="All agent instances across users. Deleted rows and orphan events stay here for audit."
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
        <form action="/api/admin/reconcile" method="POST" className="ml-auto pb-1">
          <Button type="submit" variant="outline" size="sm">
            Run reconciler
          </Button>
        </form>
      </div>

      {active !== "orphans" && rows.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing to show</EmptyTitle>
            <EmptyDescription>No instances match this filter.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {active !== "orphans" && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((instance) => (
            <Card key={instance.id}>
              <CardContent className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="truncate font-medium text-foreground">{instance.name}</h3>
                    <Badge variant={statusBadgeVariant(instance.status)} className="font-mono">
                      {instance.status}
                    </Badge>
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
                    {instance.slug} · {instance.ipAddress || "no IP"}
                    {instance.domain && ` · ${instance.domain}`}
                  </p>
                  {active === "deleted" && (
                    <p className="mt-2 font-mono text-xs text-muted-foreground">
                      Deleted:{" "}
                      {(instance.deletedAt ?? instance.lastTransitionAt)?.toISOString().slice(0, 19) ??
                        "—"}{" "}
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
                  <p className="text-foreground">
                    {instance.region.flag} {instance.region.name}
                  </p>
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
                  <CardTitle className="font-mono text-sm">vm#{o.vmId}</CardTitle>
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

function ForceDeleteForm({ instanceId }: { instanceId: string }) {
  return (
    <form action={`/api/instances/${instanceId}/delete`} method="POST" className="mt-2">
      <Button type="submit" variant="outline" size="sm" className="text-destructive">
        Force delete
      </Button>
    </form>
  )
}
