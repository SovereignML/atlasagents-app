import { NextResponse } from "next/server"
import { db, auditLogs, eq, desc, and, gte } from "@/db"
import { getEffectiveUserId } from "@/lib/effective-user"
import { AUDIT_RETENTION_DAYS } from "@/lib/audit"

/** Quote a CSV field and escape any embedded double-quotes. */
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * GET /api/audit-log/export
 *
 * Streams the caller's audit log for the last AUDIT_RETENTION_DAYS as CSV.
 * Always the full window — no filter param — so the export is complete
 * regardless of any on-screen filter.
 */
export async function GET() {
  const userId = await getEffectiveUserId()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86_400_000)

  const events = await db.query.auditLogs.findMany({
    where: and(eq(auditLogs.userId, userId), gte(auditLogs.createdAt, cutoff)),
    orderBy: [desc(auditLogs.createdAt)],
    with: { user: { columns: { email: true, name: true } } },
  })

  const header = "time,action,target,actor,ip"
  const rows = events.map((e) =>
    [
      e.createdAt.toISOString(),
      e.action,
      e.targetLabel || e.targetId || "",
      e.user?.name || e.user?.email || e.userId,
      e.ipAddress || "",
    ]
      .map((v) => csvField(String(v)))
      .join(","),
  )
  const csv = [header, ...rows].join("\n")

  const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
