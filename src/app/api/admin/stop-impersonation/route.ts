import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { stopImpersonation } from "@/lib/impersonation"
import { logAuditEvent } from "@/lib/audit"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  await stopImpersonation()

  await logAuditEvent({
    userId: session.user.id,
    action: "admin.stop_impersonation",
  })

  return NextResponse.json({ ok: true })
}
