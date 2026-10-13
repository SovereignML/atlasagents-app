import { NextResponse } from "next/server"
import { db, users, verificationTokens, eq, and } from "@/db"
import { hashPassword } from "@/lib/password"
import { rateLimit } from "@/lib/rate-limit"
import { clientIp } from "@/lib/client-ip"
import crypto from "crypto"
import { readJsonBody } from "@/lib/request-body"
import { resetPasswordSchema } from "@/lib/validations"

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, resetPasswordSchema)
    if (!body.ok) return body.res
    const { token, email, password } = body.data

    // Throttle token guessing before any DB work: per-email (an attacker who
    // knows the address can't brute-force the token) and per-IP.
    const ip = clientIp(request.headers)
    if (
      !(await rateLimit(`reset-password:${email.toLowerCase()}`, 10, 15 * 60 * 1000)) ||
      !(await rateLimit(`reset-password-ip:${ip}`, 30, 15 * 60 * 1000))
    ) {
      return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 })
    }

    // Hash the incoming token to compare with stored hash
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex")

    const storedToken = await db.query.verificationTokens.findFirst({
      where: and(
        eq(verificationTokens.identifier, email.toLowerCase()),
        eq(verificationTokens.token, hashedToken),
      ),
    })

    if (!storedToken) {
      return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 })
    }

    if (storedToken.expires < new Date()) {
      // Clean up expired token
      await db.delete(verificationTokens).where(and(
        eq(verificationTokens.identifier, storedToken.identifier),
        eq(verificationTokens.token, storedToken.token),
      ))
      return NextResponse.json({ error: "Reset link has expired. Please request a new one." }, { status: 400 })
    }

    // Update password
    const hashed = await hashPassword(password)
    await db
      .update(users)
      .set({ hashedPassword: hashed })
      .where(eq(users.email, email.toLowerCase()))

    // Delete used token
    await db.delete(verificationTokens).where(and(
      eq(verificationTokens.identifier, storedToken.identifier),
      eq(verificationTokens.token, storedToken.token),
    ))

    return NextResponse.json({ message: "Password reset successfully" })
  } catch (error) {
    console.error("Reset password error:", error)
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
