import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, users, eq } from "@/db"
import { rateLimit } from "@/lib/rate-limit"
import { issueAndSendVerification } from "@/lib/email-verification"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { email: true, emailVerified: true },
  })
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Rate limit: 3 per email per hour.
  if (!(await rateLimit(`resend-verify:${user.email.toLowerCase()}`, 3, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 })
  }

  // Already verified → generic success, no-op.
  if (user.emailVerified) {
    return NextResponse.json({ message: "Email already verified" })
  }

  await issueAndSendVerification(user.email)
  return NextResponse.json({ message: "Verification email sent" })
}
