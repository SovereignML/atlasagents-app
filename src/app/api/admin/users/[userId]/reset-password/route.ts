import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-guard"
import { db, eq, users } from "@/db"
import { hashPassword } from "@/lib/password"
import { logAuditEvent } from "@/lib/audit"
import { z } from "zod"

const resetPasswordSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters"),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return guard.res

    const { userId } = await params

    const body = await request.json()
    const validation = resetPasswordSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.flatten() },
        { status: 400 }
      )
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const hashedPassword = await hashPassword(validation.data.password)

    await db
      .update(users)
      .set({ hashedPassword })
      .where(eq(users.id, userId))

    await logAuditEvent({
      userId: guard.userId,
      action: "admin.reset_password",
      targetType: "user",
      targetId: userId,
      targetLabel: user.email ?? undefined,
    })

    return NextResponse.json({ message: "Password reset successfully" })
  } catch (error) {
    console.error("Failed to reset password:", error)
    return NextResponse.json(
      { error: "Failed to reset password" },
      { status: 500 }
    )
  }
}
