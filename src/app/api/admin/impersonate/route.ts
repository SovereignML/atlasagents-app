import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, users, eq } from "@/db"
import { z } from "zod"
import { startImpersonation } from "@/lib/impersonation"
import { logAuditEvent } from "@/lib/audit"

const schema = z.object({ userId: z.string().min(1) })

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }

  if (parsed.data.userId === session.user.id) {
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
    userId: session.user.id,
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
