import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { providerUpdateSchema } from "@/lib/validations"
import { logAuditEvent } from "@/lib/audit"
import { db, providers, regions, eq } from "@/db"

// PATCH /api/admin/providers/:providerId
// Enable/disable, set scoring priority, or pin/unpin the provider for a region.
export async function PATCH(
  request: Request,
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
  const body = await request.json().catch(() => null)
  const parsed = providerUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const provider = await db.query.providers.findFirst({ where: eq(providers.id, providerId) })
  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 })
  }

  const { enabled, priority, pinnedRegionId } = parsed.data

  // Validate a non-null region pin actually exists.
  if (pinnedRegionId) {
    const region = await db.query.regions.findFirst({ where: eq(regions.id, pinnedRegionId) })
    if (!region) {
      return NextResponse.json({ error: "pinnedRegionId does not exist" }, { status: 400 })
    }
  }

  const set: Partial<typeof provider> = {}
  if (enabled !== undefined) set.enabled = enabled
  if (priority !== undefined) set.priority = priority
  if (pinnedRegionId !== undefined) set.pinnedRegionId = pinnedRegionId

  const [updated] = await db
    .update(providers)
    .set(set)
    .where(eq(providers.id, providerId))
    .returning()

  await logAuditEvent({
    userId: session.user.id as string,
    action: "admin.provider.update",
    targetType: "provider",
    targetId: providerId,
    targetLabel: provider.name,
    meta: set,
  })

  return NextResponse.json(updated)
}
