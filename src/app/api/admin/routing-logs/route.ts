import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, routingLogs, eq, and, desc } from "@/db"
import type { SQL } from "drizzle-orm"

// GET /api/admin/routing-logs?instanceId=&providerId=&limit=
// Recent routing decisions for the dashboard / debugging.
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const instanceId = searchParams.get("instanceId")
  const providerId = searchParams.get("providerId")
  const limit = Math.min(Number(searchParams.get("limit") || 100), 500)

  const conditions: SQL[] = []
  if (instanceId) conditions.push(eq(routingLogs.instanceId, instanceId))
  if (providerId) conditions.push(eq(routingLogs.chosenProviderId, providerId))
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db
    .select()
    .from(routingLogs)
    .where(where)
    .orderBy(desc(routingLogs.createdAt))
    .limit(limit)

  return NextResponse.json(rows)
}
