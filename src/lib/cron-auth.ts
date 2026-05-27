import crypto from "node:crypto"
import type { NextRequest } from "next/server"

/**
 * Constant-time check that the request carries `Authorization: Bearer <token>`
 * matching the expected cron token. Returns false if the expected token is
 * unset, the header is missing/malformed, or the lengths differ.
 *
 * Uses crypto.timingSafeEqual to avoid leaking the token byte-by-byte through
 * response-time side channels. timingSafeEqual requires equal-length buffers,
 * so a length mismatch short-circuits to false (the length is not itself a
 * secret worth protecting).
 */
export function isValidCronBearer(
  req: NextRequest,
  expected: string | undefined,
): boolean {
  if (!expected) return false
  const authHeader = req.headers.get("authorization") ?? ""
  if (!authHeader.startsWith("Bearer ")) return false
  const bearer = authHeader.slice(7)
  const a = Buffer.from(bearer)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
