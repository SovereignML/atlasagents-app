import { auth } from "@/auth"
import { db, eq, and, gte, sql, ne, instances, subscriptions, users, usageEvents, instanceLogs } from "@/db"
import { redirect } from "next/navigation"
import { whereUserInstancesVisible } from "@/lib/instance-queries"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { findPlanBySlug } from "@/configs/plans"
import { getEffectiveUserId } from "@/lib/effective-user"

const STATUS_STYLES: Record<string, string> = {
  running: "bg-primary/10 text-primary border-primary/30",
  provisioning: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  stopped: "bg-[var(--card-bg)] text-[var(--text-secondary)] border-[var(--border-color)]",
  failed: "bg-red-500/10 text-red-500 border-red-500/30",
  deleted: "bg-[var(--card-bg)] text-[var(--text-secondary)]/50 border-[var(--border-color)]",
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [allInstances, allSubscriptions, user, usage30Rows, incidents24Rows] = await Promise.all([
    db.query.instances.findMany({
      where: whereUserInstancesVisible(effectiveUserId),
      with: { region: true, serverConfig: true },
      orderBy: (t, { desc }) => desc(t.createdAt),
    }),
    db.query.subscriptions.findMany({
      where: eq(subscriptions.userId, effectiveUserId),
      with: { plan: true },
    }),
    db.query.users.findFirst({
      where: eq(users.id, effectiveUserId),
      columns: { credits: true },
    }),
    db
      .select({ total: sql<number>`coalesce(sum(${usageEvents.amount}), 0)` })
      .from(usageEvents)
      .where(and(eq(usageEvents.userId, effectiveUserId), gte(usageEvents.createdAt, since30))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(instanceLogs)
      .innerJoin(instances, eq(instanceLogs.instanceId, instances.id))
      .where(
        and(
          eq(instances.userId, effectiveUserId),
          ne(instances.status, "deleted"),
          eq(instanceLogs.level, "error"),
          gte(instanceLogs.createdAt, since24)
        )
      ),
  ])

  const activeInstances = allInstances.filter((i) => i.status === "running").length
  const activeSubs = allSubscriptions.filter((s) => s.status === "active").length
  const monthlySpend = allSubscriptions
    .filter((s) => s.status === "active")
    .reduce((sum, s) => {
      const cfg = findPlanBySlug(s.plan?.slug ?? "")
      return sum + (cfg?.displayPriceMonthly ?? 0)
    }, 0)
  const credits = user?.credits ?? 0
  const usageTotal = Number(usage30Rows[0]?.total ?? 0)
  const incidents24 = Number(incidents24Rows[0]?.count ?? 0)

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Dashboard
          </h1>
          <p className="text-[var(--text-secondary)] mt-1 text-sm">Manage your AI agents</p>
        </div>
        <Link href="/dashboard/deploy" className="btn-gradient !py-2.5 !px-5 !text-sm">
          + Deploy New
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Active Agents", value: activeInstances.toString(), accent: true, hint: `of ${allInstances.length} total` },
          { label: "Credits Remaining", value: credits.toLocaleString(), accent: false, hint: `${usageTotal.toLocaleString()} used last 30d` },
          { label: "Monthly Spend", value: `$${monthlySpend.toFixed(2)}`, accent: false, hint: `across ${activeSubs} sub${activeSubs === 1 ? "" : "s"}` },
          { label: "Incidents 24h", value: incidents24.toString(), accent: false, hint: incidents24 === 0 ? "all systems up" : "check monitoring" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-6">
            <p className="text-xs text-[var(--text-secondary)] font-medium">
              {stat.label}
            </p>
            <p className={`text-3xl font-bold mt-2 ${stat.accent ? "text-primary" : "text-[var(--text-primary)]"}`}>
              {stat.value}
            </p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              {stat.hint}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/dashboard/deploy"
          className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-5 hover:shadow-[var(--shadow-hover)] hover:-translate-y-1 transition-all"
        >
          <p className="text-xs text-primary font-medium">Quick Action</p>
          <p className="text-lg font-bold text-[var(--text-primary)] mt-2">Deploy new agent</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">From template or scratch</p>
        </Link>
        <Link
          href="/dashboard/monitoring"
          className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-5 hover:shadow-[var(--shadow-hover)] hover:-translate-y-1 transition-all"
        >
          <p className="text-xs text-primary font-medium">Health</p>
          <p className="text-lg font-bold text-[var(--text-primary)] mt-2">Monitoring</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Uptime + latency across agents</p>
        </Link>
        <Link
          href="/dashboard/billing"
          className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-5 hover:shadow-[var(--shadow-hover)] hover:-translate-y-1 transition-all"
        >
          <p className="text-xs text-primary font-medium">Billing</p>
          <p className="text-lg font-bold text-[var(--text-primary)] mt-2">Credits & invoices</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Top up or download invoices</p>
        </Link>
      </div>

      <div>
        <h2 className="text-lg font-bold text-[var(--text-primary)] mb-4">
          Your Agents
        </h2>
        {allInstances.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-12 text-center">
            <p className="text-[var(--text-secondary)] mb-4">No agents deployed yet. Launch your first AI agent.</p>
            <Link href="/dashboard/deploy" className="btn-gradient !text-sm !py-3 !px-6 inline-flex">
              Deploy Agent
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--border-color)] overflow-hidden shadow-[var(--shadow-sm)]">
            {allInstances.map((instance, idx) => (
              <Link
                key={instance.id}
                href={`/dashboard/instances/${instance.id}`}
                className={`block bg-[var(--card-bg)] p-5 hover:bg-[var(--card-hover)] transition-all ${idx > 0 ? "border-t border-[var(--border-color)]" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[var(--text-primary)] font-medium">{instance.name}</p>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-mono">
                      {instance.slug}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right text-sm">
                      <p className="text-[var(--text-primary)]">{instance.region.flag} {instance.region.name}</p>
                      <p className="text-[var(--text-secondary)] text-xs font-mono">
                        {instance.serverConfig.label} &middot; {instance.serverConfig.vcpu} vCPU &middot; {instance.serverConfig.ramGb} GB
                      </p>
                    </div>
                    <Badge className={STATUS_STYLES[instance.status] || STATUS_STYLES.stopped}>
                      {instance.status}
                    </Badge>
                  </div>
                </div>
                {instance.ipAddress && (
                  <p className="text-xs text-[var(--text-secondary)] mt-2 font-mono">
                    IP: {instance.ipAddress}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
