import { NextResponse, type NextRequest } from "next/server"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isValidCronBearer } from "@/lib/cron-auth"

/**
 * Page-level admin gate for server components. Redirects non-admins instead of
 * returning a response. Call at the top of every /admin server page that queries
 * the DB directly — the layout gate is not sufficient on its own because App
 * Router pages render in parallel with their layout, so a layout redirect does
 * NOT reliably prevent a page's server-side data fetch from running.
 *
 *   export default async function Page() {
 *     await requireAdminPage()
 *     ...
 *   }
 */
export async function requireAdminPage(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  if ((session.user as { role?: string }).role !== "admin") redirect("/dashboard")
  return session.user.id
}

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

/**
 * Gate a route that both the scheduler and an admin may call: a bearer token
 * matching `cronToken`, or an admin-role session. `userId` is null for a cron
 * call.
 *
 *   const guard = await requireAdminOrCron(req, process.env.RECONCILE_CRON_TOKEN)
 *   if (!guard.ok) return guard.res
 */
export async function requireAdminOrCron(
  req: NextRequest,
  cronToken: string | undefined,
): Promise<{ ok: true; userId: string | null } | { ok: false; res: NextResponse }> {
  if (isValidCronBearer(req, cronToken)) return { ok: true, userId: null }
  return requireAdmin()
}
