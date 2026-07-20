import { NextResponse } from "next/server"
import { db, users, verificationTokens, eq, and } from "@/db"
import { hashPassword } from "@/lib/password"
import { rateLimit } from "@/lib/rate-limit"
import crypto from "crypto"

export async function POST(request: Request) {
  try {
    const { token, email, password } = await request.json()

    if (!token || !email || !password) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 })
    }

    // Throttle token guessing before any DB work: per-email (an attacker who
    // knows the address can't brute-force the token) and per-IP.
    const ip = request.headers.get("x-forwarded-for") || "unknown"
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
