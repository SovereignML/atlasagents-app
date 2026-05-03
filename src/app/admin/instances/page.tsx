import { db, desc, instances, orphanEvents, sql } from "@/db"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  running: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  provisioning: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  stopped: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  failed_provisioning: "bg-red-500/20 text-red-400 border-red-500/30",
  deleting: "bg-zinc-700/40 text-zinc-300 border-zinc-600/40",
  deleted: "bg-zinc-800/20 text-zinc-600 border-zinc-800/30",
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
    orphans: sql`1 = 0`, // handled separately below
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
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Admin · Instances</h1>
        <p className="text-zinc-400 mt-1">
          All OpenClaw instances across users. Deleted rows and orphan events
          stay here for audit.
        </p>
      </div>

      <div className="flex gap-1 border-b border-white/10">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`?tab=${t.id}`}
            className={`px-4 py-2 text-xs uppercase tracking-wide border-b-2 ${
              active === t.id
                ? "border-emerald-400 text-emerald-400"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </Link>
        ))}
        <form action="/api/admin/reconcile" method="POST" className="ml-auto">
          <button
            className="px-3 py-2 text-xs uppercase tracking-wide border border-white/10 text-zinc-300 hover:text-white"
            formAction="/api/admin/reconcile"
          >
            Run reconciler
          </button>
        </form>
      </div>

      {active !== "orphans" && rows.length === 0 && (
        <p className="text-zinc-400">Nothing to show.</p>
      )}

      {active !== "orphans" && (
        <div className="space-y-3">
          {rows.map((instance) => (
            <div
              key={instance.id}
              className="bg-white/5 border border-white/10 rounded-xl p-5"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="text-white font-medium truncate">{instance.name}</h3>
                    <Badge className={STATUS_STYLES[instance.status] || STATUS_STYLES.stopped}>
                      {instance.status}
                    </Badge>
                    {instance.vmId && (
                      <span className="text-[10px] font-mono text-zinc-500">
                        vm#{instance.vmId}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-400 mt-1">{instance.user.email}</p>
                  <p className="text-xs text-zinc-500 font-mono truncate">
                    {instance.slug} · {instance.ipAddress || "no IP"}
                    {instance.domain && ` · ${instance.domain}`}
                  </p>
                  {active === "deleted" && (
                    <p className="text-xs text-zinc-500 mt-2 font-mono">
                      Deleted:{" "}
                      {(instance.deletedAt ?? instance.lastTransitionAt)?.toISOString().slice(0, 19) ?? "—"} UTC
                      {instance.lastActiveAt && (
                        <>
                          {" "}
                          · Last active: {instance.lastActiveAt.toISOString().slice(0, 19)} UTC
                        </>
                      )}
                    </p>
                  )}
                  {instance.lastError && (
                    <p className="text-xs text-red-400 mt-1 font-mono">
                      lastError: {instance.lastError}
                    </p>
                  )}
                </div>
                <div className="text-right text-sm shrink-0">
                  <p className="text-zinc-300">
                    {instance.region.flag} {instance.region.name}
                  </p>
                  <p className="text-zinc-500">
                    {instance.serverConfig.label} · {instance.serverConfig.vcpu} vCPU
                    · {instance.serverConfig.ramGb} GB
                  </p>
                  <p className="text-zinc-600 text-xs mt-1">
                    {instance.createdAt.toISOString().slice(0, 10)}
                  </p>
                  {(instance.status === "failed_provisioning" ||
                    instance.status === "deleting") && (
                    <ForceDeleteForm instanceId={instance.id} />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {active === "orphans" && (
        <div className="space-y-2">
          {orphans.length === 0 && (
            <p className="text-zinc-400">No orphan events recorded.</p>
          )}
          {orphans.map((o) => (
            <div
              key={o.id}
              className="bg-white/5 border border-white/10 rounded p-3 text-sm flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <p className="text-white font-mono">vm#{o.vmId}</p>
                <p className="text-zinc-500 text-xs truncate">{o.detail ?? ""}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-zinc-300 text-xs uppercase">{o.action}</p>
                <p className="text-zinc-600 text-[10px]">
                  detected {o.detectedAt.toISOString().slice(0, 19)}
                </p>
                {o.resolvedAt && (
                  <p className="text-emerald-500/70 text-[10px]">
                    resolved {o.resolvedAt.toISOString().slice(0, 19)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Admin-only force-delete. Hits the same delete route as users do — that
 * route already enforces the state machine and retry-backed Linode delete.
 * Admins are allowed through the userId check in that handler.
 */
function ForceDeleteForm({ instanceId }: { instanceId: string }) {
  return (
    <form action={`/api/instances/${instanceId}/delete`} method="POST" className="mt-2">
      <button className="px-3 py-1 text-xs uppercase tracking-wide border border-red-500/40 text-red-400 hover:bg-red-500/10">
        Force delete
      </button>
    </form>
  )
}
