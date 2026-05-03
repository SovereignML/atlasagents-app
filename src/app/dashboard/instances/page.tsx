import { auth } from "@/auth"
import { db, desc, instances } from "@/db"
import { redirect } from "next/navigation"
import Link from "next/link"
import { whereUserInstancesVisible } from "@/lib/instance-queries"
import { InstancesFilter } from "./instances-filter"

export default async function InstancesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const rows = await db.query.instances.findMany({
    where: whereUserInstancesVisible(session.user.id),
    with: {
      region: true,
      serverConfig: true,
      logs: {
        orderBy: (logs, { desc: d }) => d(logs.createdAt),
        limit: 3,
      },
    },
    orderBy: desc(instances.createdAt),
  })

  const items = rows
    .filter((i) => i.status !== "deleted")
    .map((i) => ({
      id: i.id,
      name: i.name,
      slug: i.slug,
      status: i.status,
      ipAddress: i.ipAddress,
      regionLabel: `${i.region.flag} ${i.region.name}`,
      serverLabel: i.serverConfig.label,
      vcpu: i.serverConfig.vcpu,
      ramGb: i.serverConfig.ramGb,
      recentLogs: i.logs.map((l) => ({
        id: l.id,
        level: l.level,
        message: l.message,
        createdAt: l.createdAt.toISOString(),
      })),
    }))

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Instances
          </h1>
          <p className="text-[var(--text-secondary)] mt-1 text-sm">All your deployed AI agents</p>
        </div>
        <Link href="/dashboard/deploy" className="btn-gradient !py-2.5 !px-5 !text-sm">
          + Deploy New
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-12 text-center">
          <p className="text-[var(--text-secondary)] mb-4">No instances yet.</p>
          <Link href="/dashboard/deploy" className="btn-gradient inline-flex text-sm px-6 py-3">
            Deploy Agent
          </Link>
        </div>
      ) : (
        <InstancesFilter items={items} />
      )}
    </div>
  )
}
