import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-guard"
import { getProvidersOverview } from "@/lib/provider-admin"

// GET /api/admin/providers
// Provider registry joined with budget, latest health probe, and a trailing
// success rate — the data the dashboard renders.
export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const overview = await getProvidersOverview()
  return NextResponse.json(overview)
}
