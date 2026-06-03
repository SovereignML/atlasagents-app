import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { stopImpersonation } from "@/lib/impersonation"
import { logAuditEvent } from "@/lib/audit"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // Any authenticated user may stop impersonating — it only clears their own
  // impersonation cookie, returning them to themselves. Covers both platform
  // admins and white-label tenant admins.

  await stopImpersonation()

  await logAuditEvent({
    userId: session.user.id,
    action: "admin.stop_impersonation",
  })

  return NextResponse.json({ ok: true })
}
