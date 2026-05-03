import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { stopImpersonation } from "@/lib/impersonation"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  await stopImpersonation()
  return NextResponse.json({ ok: true })
}
