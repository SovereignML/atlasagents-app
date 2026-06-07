/**
 * Email-verification token helpers.
 *
 * Tokens live in the shared `verificationTokens` table but under a NAMESPACED
 * identifier (`email-verify:<email>`) so they never collide with password-reset
 * tokens, which key on the bare email and match/delete on the exact identifier.
 * A pending reset and a pending verify can coexist.
 *
 * Mirrors the raw-token-in-email / sha256-hash-in-db pattern used by the
 * forgot-password / reset-password routes.
 */

import crypto from "crypto"
import { db, verificationTokens, eq } from "@/db"
import { sendVerificationEmail } from "@/lib/email"

const PREFIX = "email-verify:"
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export function emailVerifyIdentifier(email: string): string {
  return `${PREFIX}${email.toLowerCase()}`
}

export function hashVerificationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex")
}

/**
 * Replace any pending verification token for this email with a fresh one and
 * email the verification link. Returns the email-send result.
 */
export async function issueAndSendVerification(email: string) {
  const identifier = emailVerifyIdentifier(email)
  await db
    .delete(verificationTokens)
    .where(eq(verificationTokens.identifier, identifier))

  const rawToken = crypto.randomBytes(32).toString("hex")
  await db.insert(verificationTokens).values({
    identifier,
    token: hashVerificationToken(rawToken),
    expires: new Date(Date.now() + TTL_MS),
  })

  return sendVerificationEmail(email, rawToken)
}
