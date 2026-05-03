import { NextRequest, NextResponse } from "next/server"
import { db, auditLogs, eq, desc, and, like } from "@/db"
import { getEffectiveUserId } from "@/lib/effective-user"

export async function GET(req: NextRequest) {
  const userId = await getEffectiveUserId()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get("limit") || "50"), 100)
  const offset = Math.max(Number(url.searchParams.get("offset") || "0"), 0)
  const filter = url.searchParams.get("filter") || ""

  const conditions = [eq(auditLogs.userId, userId)]
  if (filter) {
    conditions.push(like(auditLogs.action, `${filter}%`))
  }

  const events = await db.query.auditLogs.findMany({
    where: and(...conditions),
    orderBy: [desc(auditLogs.createdAt)],
    limit,
    offset,
    with: { user: { columns: { email: true, name: true } } },
  })

  return NextResponse.json(
    events.map((e) => ({
      id: e.id,
      at: e.createdAt.toISOString(),
      actor: e.user?.name || e.user?.email || e.userId,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      target: e.targetLabel || e.targetId || "",
      ip: e.ipAddress || "",
      meta: e.meta,
    })),
  )
}
