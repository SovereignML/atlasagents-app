import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { runReconciler } from "@/lib/reconciler"

// POST /api/admin/reconcile
//
// Runs the reconciliation worker. Two ways to authorize:
//   1. An admin-role user session (for manual runs from the admin panel).
//   2. A bearer token matching RECONCILE_CRON_TOKEN (for scheduled cron).
//
// Long-running — set your cron timeout to at least 60s.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? ""
  const cronToken = process.env.RECONCILE_CRON_TOKEN
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  const isCron = !!(cronToken && bearer && bearer === cronToken)

  if (!isCron) {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if ((session.user as { role?: string }).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const report = await runReconciler()
  return NextResponse.json(report)
}
