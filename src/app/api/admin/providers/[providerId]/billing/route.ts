import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { providerBillingSchema } from "@/lib/validations"
import { logAuditEvent } from "@/lib/audit"
import { db, providers, providerBilling, eq } from "@/db"

// PATCH /api/admin/providers/:providerId/billing
// Set the internal budget for a provider: monthly credits + soft/hard limits.
// Creates the billing row if one doesn't exist yet.
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
  const parsed = providerBillingSchema.safeParse(body)
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

  const { monthlyCreditsUsd, softLimitUsd, hardLimitUsd } = parsed.data
  const set: Record<string, number | null> = {}
  if (monthlyCreditsUsd !== undefined) set.monthlyCreditsUsd = monthlyCreditsUsd
  if (softLimitUsd !== undefined) set.softLimitUsd = softLimitUsd
  if (hardLimitUsd !== undefined) set.hardLimitUsd = hardLimitUsd

  const existing = await db.query.providerBilling.findFirst({
    where: eq(providerBilling.providerId, providerId),
  })

  let updated
  if (existing) {
    ;[updated] = await db
      .update(providerBilling)
      .set(set)
      .where(eq(providerBilling.providerId, providerId))
      .returning()
  } else {
    ;[updated] = await db
      .insert(providerBilling)
      .values({ providerId, ...set })
      .returning()
  }

  await logAuditEvent({
    userId: session.user.id as string,
    action: "admin.provider.billing_update",
    targetType: "provider",
    targetId: providerId,
    targetLabel: provider.name,
    meta: set,
  })

  return NextResponse.json(updated)
}
