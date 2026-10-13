import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-guard"
import { db, eq, users } from "@/db"
import { logAuditEvent } from "@/lib/audit"
import { getFreeTierUsage } from "@/lib/free-tier"
import { z } from "zod"

// PATCH { limit: number | null } — set a per-user free-agent lifetime cap, or
// null to clear the override and fall back to the platform default. Admin-only.
const schema = z.object({
  limit: z.number().int().min(0).max(1000).nullable(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.res

    const { userId } = await params

    const body = await request.json()
    const validation = schema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.flatten() },
        { status: 400 },
      )
    }

    const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const { limit } = validation.data

    await db
      .update(users)
      .set({ freeAgentLimit: limit })
      .where(eq(users.id, userId))

    await logAuditEvent({
      userId: guard.userId,
      action: "admin.set_free_limit",
      targetType: "user",
      targetId: userId,
      targetLabel: user.email ?? undefined,
    })

    // Return the recomputed usage so the client can refresh without a round-trip.
    const usage = await getFreeTierUsage(userId)
    return NextResponse.json(usage)
  } catch (error) {
    console.error("Failed to set free-tier limit:", error)
    return NextResponse.json(
      { error: "Failed to set free-tier limit" },
      { status: 500 },
    )
  }
}
