import { NextResponse } from "next/server"
import { db, users, verificationTokens, eq } from "@/db"
import { rateLimit } from "@/lib/rate-limit"
import { sendPasswordResetEmail } from "@/lib/email"
import crypto from "crypto"

export async function POST(request: Request) {
  try {
    const { email } = await request.json()
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    // Rate limit: 3 per email per hour
    if (!rateLimit(`forgot-password:${email.toLowerCase()}`, 3, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 })
    }

    // Always return success to not leak whether email exists
    const user = await db.query.users.findFirst({
      where: eq(users.email, email.toLowerCase()),
    })

    if (user) {
      // Delete any existing tokens for this user
      await db
        .delete(verificationTokens)
        .where(eq(verificationTokens.identifier, email.toLowerCase()))

      // Generate token
      const token = crypto.randomBytes(32).toString("hex")
      const hashedToken = crypto.createHash("sha256").update(token).digest("hex")

      // Store hashed token (expires in 1 hour)
      await db.insert(verificationTokens).values({
        identifier: email.toLowerCase(),
        token: hashedToken,
        expires: new Date(Date.now() + 60 * 60 * 1000),
      })

      // Send email with unhashed token
      await sendPasswordResetEmail(email.toLowerCase(), token)
    }

    return NextResponse.json({ message: "If an account exists with that email, we sent a reset link." })
  } catch (error) {
    console.error("Forgot password error:", error)
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
