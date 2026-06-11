import crypto from "node:crypto"
import type { NextRequest } from "next/server"

/**
 * Constant-time check that `Authorization: Bearer <token>` carries a token
 * matching `expected`. Returns false if `expected` is unset, the header is
 * missing/malformed, or the lengths differ.
 *
 * Uses crypto.timingSafeEqual to avoid leaking the token byte-by-byte through
 * response-time side channels. timingSafeEqual requires equal-length buffers,
 * so a length mismatch short-circuits to false (the length is not itself a
 * secret worth protecting).
 *
 * Reused by both cron routes (expected = an env token) and the per-instance
 * event-ingest endpoint (expected = the instance's decrypted ingest token).
 */
export function timingSafeBearerEquals(
  req: NextRequest,
  expected: string | undefined | null,
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

/**
 * Cron-route variant: validates the request bearer against a cron env token.
 * Thin alias kept for the existing call sites in the internal/cron routes.
 */
export function isValidCronBearer(
  req: NextRequest,
  expected: string | undefined,
): boolean {
  return timingSafeBearerEquals(req, expected)
}
