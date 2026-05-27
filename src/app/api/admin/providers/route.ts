import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getProvidersOverview } from "@/lib/provider-admin"

// GET /api/admin/providers
// Provider registry joined with budget, latest health probe, and a trailing
// success rate — the data the dashboard renders.
export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const overview = await getProvidersOverview()
  return NextResponse.json(overview)
}
