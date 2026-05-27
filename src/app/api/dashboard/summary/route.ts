import { NextResponse } from "next/server"
import { db, eq, and, gte, sql, ne, instances, subscriptions, usageEvents, instanceLogs, wallets } from "@/db"
import { whereUserInstancesVisible } from "@/lib/instance-queries"
import { getEffectiveUserId } from "@/lib/effective-user"

export async function GET() {
  const userId = await getEffectiveUserId()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [
    userInstances,
    activeSubRows,
    wallet,
    usage30Rows,
    incident24Rows,
  ] = await Promise.all([
    db.query.instances.findMany({
      where: whereUserInstancesVisible(userId),
      columns: { id: true, status: true },
    }),
    db
      .select({ count: sql<number>`count(*)` })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active"))),
    db.query.wallets.findFirst({
      where: eq(wallets.userId, userId),
      columns: { balance: true },
    }),
    db
      .select({ total: sql<number>`coalesce(sum(${usageEvents.amount}), 0)` })
      .from(usageEvents)
      .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, since30))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(instanceLogs)
      .innerJoin(instances, eq(instanceLogs.instanceId, instances.id))
      .where(
        and(
          eq(instances.userId, userId),
          ne(instances.status, "deleted"),
          eq(instanceLogs.level, "error"),
          gte(instanceLogs.createdAt, since24)
        )
      ),
  ])

  const activeInstances = userInstances.filter((i) => i.status === "running").length

  return NextResponse.json({
    activeInstances,
    totalInstances: userInstances.length,
    activeSubscriptions: Number(activeSubRows[0]?.count ?? 0),
    credits: Math.round(wallet?.balance ?? 0),
    usage30dTotal: Number(usage30Rows[0]?.total ?? 0),
    incidents24h: Number(incident24Rows[0]?.count ?? 0),
  })
}
