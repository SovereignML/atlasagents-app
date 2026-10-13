import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/admin-guard"
import { db, eq, or, and, gte, sql, users, auditLogs } from "@/db"
import { adminAdjustCredits } from "@/lib/billing"
import { logAuditEvent } from "@/lib/audit"
import { notify } from "@/lib/notifications/dispatch"
import { formatCredits } from "@/lib/credit-pricing"
import { adminCreditLimits, adjustmentRefusal } from "@/lib/admin-credit-limits"
import { createAdminNotification } from "@/lib/admin-notify"
import { rateLimit } from "@/lib/rate-limit"

const schema = z.object({
  // Identify the target by id or email — whichever the admin has on hand.
  userId: z.string().min(1).optional(),
  email: z.string().email().optional(),
  // Signed: positive grants, negative removes. The per-call and daily limits
  // are applied below (src/lib/admin-credit-limits.ts).
  credits: z
    .number()
    .int()
    .refine((n) => n !== 0, "credits must be non-zero"),
  reason: z.string().min(3).max(500),
})

/**
 * POST /api/admin/billing/adjust
 *
 * Manual credit grant/removal by an admin, logged to the wallet ledger
 * (admin_grant) and the audit log, with a required reason. Positive grants,
 * negative removes (settlement). The user is notified of the change.
 *
 * Bounded: a per-call limit, a 24-hour cap on each admin's grants (summed from
 * their admin.credit_adjust audit events), 20 calls an hour per admin, and an
 * admin notification for large adjustments.
 */
export async function POST(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

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

  if (!(await rateLimit(`admin-adjust:${guard.userId}`, 20, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many adjustments this hour." }, { status: 429 })
  }
  const limits = adminCreditLimits()
  const [{ granted }] = await db
    .select({
      granted: sql<number>`coalesce(sum(greatest((${auditLogs.meta}->>'credits')::int, 0)), 0)::int`,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.userId, guard.userId),
        eq(auditLogs.action, "admin.credit_adjust"),
        gte(auditLogs.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    )
  const refusal = adjustmentRefusal(credits, granted, limits)
  if (refusal) return NextResponse.json({ error: refusal }, { status: 400 })

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
    userId: guard.userId,
    action: "admin.credit_adjust",
    targetType: "user",
    targetId: target.id,
    targetLabel: target.email,
    meta: { credits, reason, applied: result.applied, shortfall: result.shortfall, balance: result.balance },
  })

  if (Math.abs(credits) >= limits.alertAt) {
    await createAdminNotification({
      type: "large_credit_adjustment",
      userId: target.id,
      message: `${credits > 0 ? "Granted" : "Removed"} ${formatCredits(Math.abs(credits))} for ${target.email} (${reason}).`,
      meta: { adminUserId: guard.userId, credits, reason },
    }).catch((err) => console.error("[admin/billing/adjust] alert failed:", err))
  }

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
