import { NextResponse } from "next/server"
import { auth } from "@/auth"

/**
 * Gate a route handler on an admin-role session. Returns the admin's userId on
 * success, or a ready-to-return 401/403 NextResponse otherwise:
 *
 *   const guard = await requireAdmin()
 *   if (!guard.ok) return guard.res
 *   // use guard.userId
 */
export async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; res: NextResponse }
> {
  const session = await auth()
  if (!session?.user?.id) {
    return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { ok: true, userId: session.user.id }
}
