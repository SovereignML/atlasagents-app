import { db, eq, sql, instances, users, subscriptions } from "@/db"
import Link from "next/link"

export default async function AdminDashboard() {
  const [
    totalUsersRows,
    activeInstancesRows,
    totalInstancesRows,
    activeSubscriptionsRows,
    stoppedInstancesRows,
    bannedUsersRows,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.role, "user")),
    db.select({ count: sql<number>`count(*)` }).from(instances).where(eq(instances.status, "running")),
    db.select({ count: sql<number>`count(*)` }).from(instances),
    db.select({ count: sql<number>`count(*)` }).from(subscriptions).where(eq(subscriptions.status, "active")),
    db.select({ count: sql<number>`count(*)` }).from(instances).where(eq(instances.status, "stopped")),
    db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.isBanned, true)),
  ])

  const totalUsers = Number(totalUsersRows[0]?.count ?? 0)
  const activeInstances = Number(activeInstancesRows[0]?.count ?? 0)
  const totalInstances = Number(totalInstancesRows[0]?.count ?? 0)
  const activeSubscriptions = Number(activeSubscriptionsRows[0]?.count ?? 0)
  const stoppedInstances = Number(stoppedInstancesRows[0]?.count ?? 0)
  const bannedUsers = Number(bannedUsersRows[0]?.count ?? 0)

  const recentInstances = await db.query.instances.findMany({
    with: { user: true, region: true, serverConfig: true },
    orderBy: (t, { desc }) => desc(t.createdAt),
    limit: 10,
  })

  const stats = [
    { label: "Total Users", value: totalUsers, accent: false },
    { label: "Active Instances", value: activeInstances, accent: true },
    { label: "Total Instances", value: totalInstances, accent: false },
    { label: "Active Subs", value: activeSubscriptions, accent: false },
  ]

  return (
    <div className="space-y-8 max-w-6xl">
      <h1 className="text-2xl font-bold text-[var(--text-primary)]">
        Admin Dashboard
      </h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-6">
            <p className="text-xs text-[var(--text-secondary)]">
              {stat.label}
            </p>
            <p
              className={`text-3xl font-bold mt-2 ${stat.accent ? "text-primary" : "text-[var(--text-primary)]"}`}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-6">
          <p className="text-xs text-[var(--text-secondary)]">Stopped Instances</p>
          <p className="text-3xl font-bold mt-2 text-[var(--text-secondary)]">{stoppedInstances}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-6">
          <p className="text-xs text-[var(--text-secondary)]">Banned Users</p>
          <p className="text-3xl font-bold mt-2 text-red-400">{bannedUsers}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            Recent Instances
          </h2>
          <Link
            href="/admin/instances"
            className="text-sm text-primary hover:underline"
          >
            View All &rarr;
          </Link>
        </div>
        {recentInstances.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-8 text-center">
            <p className="text-[var(--text-secondary)]">No instances yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentInstances.map((instance) => (
              <div key={instance.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-4 flex items-center justify-between hover:bg-[var(--card-hover)] transition-colors">
                <div>
                  <p className="text-[var(--text-primary)] font-medium">{instance.name}</p>
                  <p className="text-sm text-[var(--text-secondary)]">{instance.user.email}</p>
                  <p className="text-xs text-[var(--text-secondary)] font-mono">{instance.slug}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold font-mono ${
                    instance.status === "running"
                      ? "text-primary"
                      : instance.status === "provisioning"
                      ? "text-amber-400"
                      : instance.status === "failed"
                      ? "text-red-400"
                      : "text-[var(--text-secondary)]"
                  }`}>
                    {instance.status}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {instance.region.flag} {instance.region.name} &middot; {instance.serverConfig.label}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
