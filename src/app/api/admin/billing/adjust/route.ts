import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/auth"
import { db, eq, or, users } from "@/db"
import { adminAdjustCredits } from "@/lib/billing"
import { logAuditEvent } from "@/lib/audit"
import { notify } from "@/lib/notifications/dispatch"
import { formatCredits } from "@/lib/credit-pricing"

const schema = z.object({
  // Identify the target by id or email — whichever the admin has on hand.
  userId: z.string().min(1).optional(),
  email: z.string().email().optional(),
  // Signed: positive grants, negative removes. Bounded to avoid fat-finger
  // five-figure mistakes; raise the cap if you genuinely need a bigger grant.
  credits: z
    .number()
    .int()
    .refine((n) => n !== 0, "credits must be non-zero")
    .refine((n) => Math.abs(n) <= 1_000_000, "credits out of range"),
  reason: z.string().min(3).max(500),
})

/**
 * POST /api/admin/billing/adjust
 *
 * Manual credit grant/removal by an admin, logged to the wallet ledger
 * (admin_grant) and the audit log, with a required reason. Positive grants,
 * negative removes (settlement). The user is notified of the change.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const { userId, email, credits, reason } = parsed.data
  if (!userId && !email) {
    return NextResponse.json({ error: "Provide a userId or email" }, { status: 400 })
  }

  const target = await db.query.users.findFirst({
    where: userId
      ? eq(users.id, userId)
      : or(eq(users.email, email!), eq(users.id, email!)),
    columns: { id: true, email: true },
  })
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const result = await adminAdjustCredits(target.id, credits, `Admin adjustment: ${reason}`)

  await logAuditEvent({
    userId: session.user.id,
    action: "admin.credit_adjust",
    targetType: "user",
    targetId: target.id,
    targetLabel: target.email,
    meta: { credits, reason, applied: result.applied, shortfall: result.shortfall, balance: result.balance },
  })

  await notify({
    userId: target.id,
    category: "billing",
    type: "credits_adjusted",
    title: "Credit balance adjusted",
    message:
      credits > 0
        ? `An admin added ${formatCredits(credits)} to your balance (${reason}).`
        : `An admin removed ${formatCredits(-credits)} from your balance (${reason}).`,
    url: "/dashboard/billing",
  })

  return NextResponse.json({ ok: true, ...result })
}
