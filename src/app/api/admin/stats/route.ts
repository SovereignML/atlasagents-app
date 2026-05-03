import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, users, instances, subscriptions, eq, sql } from "@/db"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const countExpr = sql<number>`count(*)::int`

  const [
    totalUsersRows,
    activeInstancesRows,
    totalInstancesRows,
    activeSubscriptionsRows,
    bannedUsersRows,
  ] = await Promise.all([
    db.select({ count: countExpr }).from(users).where(eq(users.role, "user")),
    db.select({ count: countExpr }).from(instances).where(eq(instances.status, "running")),
    db.select({ count: countExpr }).from(instances),
    db.select({ count: countExpr }).from(subscriptions).where(eq(subscriptions.status, "active")),
    db.select({ count: countExpr }).from(users).where(eq(users.isBanned, true)),
  ])

  return NextResponse.json({
    totalUsers: totalUsersRows[0]?.count ?? 0,
    activeInstances: activeInstancesRows[0]?.count ?? 0,
    totalInstances: totalInstancesRows[0]?.count ?? 0,
    activeSubscriptions: activeSubscriptionsRows[0]?.count ?? 0,
    bannedUsers: bannedUsersRows[0]?.count ?? 0,
  })
}
