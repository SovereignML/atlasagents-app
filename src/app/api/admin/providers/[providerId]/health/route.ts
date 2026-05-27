import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { logAuditEvent } from "@/lib/audit"
import { db, providers, eq } from "@/db"
import { instantiateProvider } from "@/lib/providers"
import { checkProviderHealth } from "@/lib/provider-health"

// POST /api/admin/providers/:providerId/health
// Run a health probe against the provider right now and record the result.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { providerId } = await params
  const provider = await db.query.providers.findFirst({ where: eq(providers.id, providerId) })
  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 })
  }

  const health = await checkProviderHealth(providerId, instantiateProvider(provider.slug))

  await logAuditEvent({
    userId: session.user.id as string,
    action: "admin.provider.health_check",
    targetType: "provider",
    targetId: providerId,
    targetLabel: provider.name,
    meta: { status: health.status, latencyMs: health.latencyMs },
  })

  return NextResponse.json(health)
}
