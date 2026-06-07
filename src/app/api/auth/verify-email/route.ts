import { NextResponse } from "next/server"
import { db, users, verificationTokens, eq, and } from "@/db"
import {
  emailVerifyIdentifier,
  hashVerificationToken,
} from "@/lib/email-verification"

export async function POST(request: Request) {
  try {
    const { token, email } = await request.json()

    if (!token || !email) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const identifier = emailVerifyIdentifier(email)
    const hashedToken = hashVerificationToken(token)

    const storedToken = await db.query.verificationTokens.findFirst({
      where: and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.token, hashedToken),
      ),
    })

    if (!storedToken) {
      return NextResponse.json(
        { error: "Invalid or expired verification link" },
        { status: 400 },
      )
    }

    if (storedToken.expires < new Date()) {
      await db.delete(verificationTokens).where(and(
        eq(verificationTokens.identifier, storedToken.identifier),
        eq(verificationTokens.token, storedToken.token),
      ))
      return NextResponse.json(
        { error: "Verification link has expired. Please request a new one." },
        { status: 400 },
      )
    }

    // Match the email exactly as it was stored at registration and embedded in
    // the link (register doesn't lowercase). The token identifier is namespaced
    // and lowercased independently, so the lookup above already succeeded.
    await db
      .update(users)
      .set({ emailVerified: new Date() })
      .where(eq(users.email, email))

    await db.delete(verificationTokens).where(and(
      eq(verificationTokens.identifier, storedToken.identifier),
      eq(verificationTokens.token, storedToken.token),
    ))

    return NextResponse.json({ message: "Email verified" })
  } catch (error) {
    console.error("Verify email error:", error)
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 })
  }
}
