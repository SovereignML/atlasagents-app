import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-guard"
import { db, users, eq } from "@/db"
import { z } from "zod"
import { startImpersonation } from "@/lib/impersonation"
import { logAuditEvent } from "@/lib/audit"

const schema = z.object({ userId: z.string().min(1) })

export async function POST(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }

  if (parsed.data.userId === guard.userId) {
    return NextResponse.json({ error: "Cannot impersonate yourself" }, { status: 400 })
  }

  const target = await db.query.users.findFirst({
    where: eq(users.id, parsed.data.userId),
    columns: { id: true, email: true, name: true },
  })
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  await startImpersonation(target.id)

  await logAuditEvent({
    userId: guard.userId,
    action: "admin.impersonate",
    targetType: "user",
    targetId: target.id,
    targetLabel: target.email ?? undefined,
  })

  return NextResponse.json({
    ok: true,
    impersonating: { id: target.id, email: target.email, name: target.name },
  })
}
