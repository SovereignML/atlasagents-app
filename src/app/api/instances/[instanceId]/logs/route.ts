import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getEffectiveUserId } from "@/lib/effective-user"
import { db, instanceLogs, eq, and, desc, lt } from "@/db"
import { whereUserInstanceVisible } from "@/lib/instance-queries"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id

  const { instanceId } = await params

  const instance = await db.query.instances.findFirst({
    where: whereUserInstanceVisible(effectiveUserId, instanceId),
    columns: { id: true },
  })

  if (!instance) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const url = new URL(req.url)
  const cursor = url.searchParams.get("cursor")
  const level = url.searchParams.get("level")
  const limit = Math.min(
    Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT),
    MAX_LIMIT,
  )

  const conditions = [eq(instanceLogs.instanceId, instanceId)]
  if (cursor) {
    conditions.push(lt(instanceLogs.id, cursor))
  }
  if (level && level !== "all") {
    conditions.push(eq(instanceLogs.level, level))
  }

  const logs = await db.query.instanceLogs.findMany({
    where: and(...conditions),
    orderBy: desc(instanceLogs.createdAt),
    limit: limit + 1,
  })

  const hasMore = logs.length > limit
  const page = hasMore ? logs.slice(0, limit) : logs
  const nextCursor = hasMore ? page[page.length - 1].id : null

  return NextResponse.json({
    logs: page.map((l) => ({
      id: l.id,
      level: l.level,
      message: l.message,
      createdAt: l.createdAt.toISOString(),
    })),
    nextCursor,
  })
}
