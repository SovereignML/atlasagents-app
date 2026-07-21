import { NextResponse } from "next/server"
import crypto from "crypto"

import { db, eq, users, verificationTokens } from "@/db"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { isChildMember } from "@/lib/tenant-scope"
import { sendPasswordResetEmail } from "@/lib/email"
import { logAuditEvent } from "@/lib/audit"

// POST — issue a password-reset link for a customer user. Scoped: the target
// must be a member of one of this tenant's child teams. Reuses the same token
// flow as /api/auth/forgot-password. Best-effort email; never leaks failures.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  if (!(await isChildMember(admin.tenantTeamId, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { email: true },
  })
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const email = user.email.toLowerCase()

  // Delete any existing tokens for this email, then issue a fresh hashed token.
  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, email))

  const token = crypto.randomBytes(32).toString("hex")
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex")

  await db.insert(verificationTokens).values({
    identifier: email,
    token: hashedToken,
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
  })

  // Best-effort email — don't fail the request if delivery hiccups.
  try {
    await sendPasswordResetEmail(email, token)
  } catch (err) {
    console.error("tenant-admin reset-password email error:", err)
  }

  await logAuditEvent({
    userId: admin.userId,
    action: "admin.reset_password",
    teamId: admin.tenantTeamId,
    targetType: "user",
    targetId: userId,
  })

  return NextResponse.json({ ok: true })
}
