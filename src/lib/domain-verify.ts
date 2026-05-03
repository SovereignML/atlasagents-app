// Domain ownership verification via TXT record.
//
// Flow:
//   1. User calls GET /api/domain-verification?domain=foo.example — we mint
//      a nonce and show them the TXT record they must publish:
//         _sovereignml-verify.foo.example.  "sovereignml=<nonce>"
//   2. User publishes the record at their DNS host.
//   3. User calls POST /api/domain-verification/verify — we resolve the TXT
//      record and compare. If it matches, we stamp verifiedAt.
//   4. Deploy route requires a verified row before allowing `domain` on an
//      instance. Domains are per-user — two users can't claim the same.

import dns from "node:dns"
import crypto from "node:crypto"
import { db, domainVerifications, and, eq } from "@/db"

export const VERIFY_RECORD_PREFIX = "_sovereignml-verify"

export function generateNonce(): string {
  return crypto.randomBytes(16).toString("hex")
}

export function recordName(domain: string): string {
  return `${VERIFY_RECORD_PREFIX}.${domain}`
}

export function expectedValue(nonce: string): string {
  return `sovereignml=${nonce}`
}

/**
 * Find-or-create a verification row for (userId, domain). Returns the nonce
 * and a human-readable TXT record string that the caller can display.
 */
export async function getOrCreateVerification(
  userId: string,
  domain: string,
): Promise<{ nonce: string; recordName: string; expectedValue: string; verified: boolean }> {
  const normalized = domain.trim().toLowerCase()
  const existing = await db.query.domainVerifications.findFirst({
    where: and(
      eq(domainVerifications.userId, userId),
      eq(domainVerifications.domain, normalized),
    ),
  })
  if (existing) {
    return {
      nonce: existing.nonce,
      recordName: recordName(normalized),
      expectedValue: expectedValue(existing.nonce),
      verified: existing.verifiedAt != null,
    }
  }
  const nonce = generateNonce()
  await db.insert(domainVerifications).values({ userId, domain: normalized, nonce })
  return {
    nonce,
    recordName: recordName(normalized),
    expectedValue: expectedValue(nonce),
    verified: false,
  }
}

/**
 * Attempt to verify domain ownership by querying TXT records for
 * `_sovereignml-verify.<domain>`. On match, stamps verifiedAt and returns
 * true. Safe to call repeatedly.
 */
export async function verifyDomain(
  userId: string,
  domain: string,
): Promise<{ verified: boolean; reason?: string }> {
  const normalized = domain.trim().toLowerCase()
  const row = await db.query.domainVerifications.findFirst({
    where: and(
      eq(domainVerifications.userId, userId),
      eq(domainVerifications.domain, normalized),
    ),
  })
  if (!row) return { verified: false, reason: "no verification pending — request a nonce first" }
  if (row.verifiedAt) return { verified: true }

  const expected = expectedValue(row.nonce)
  let records: string[][] = []
  try {
    records = await dns.promises.resolveTxt(recordName(normalized))
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { verified: false, reason: "TXT record not found" }
    }
    return { verified: false, reason: `DNS error: ${(err as Error).message}` }
  }
  const flat = records.map((chunks) => chunks.join("")).map((s) => s.trim())
  if (!flat.includes(expected)) {
    return {
      verified: false,
      reason: `TXT record present but value did not match. Expected "${expected}". Got [${flat.join(", ")}].`,
    }
  }

  await db
    .update(domainVerifications)
    .set({ verifiedAt: new Date() })
    .where(eq(domainVerifications.id, row.id))
  return { verified: true }
}

/** Returns true if the (userId, domain) pair has been verified. */
export async function isDomainVerified(
  userId: string,
  domain: string,
): Promise<boolean> {
  const row = await db.query.domainVerifications.findFirst({
    where: and(
      eq(domainVerifications.userId, userId),
      eq(domainVerifications.domain, domain.trim().toLowerCase()),
    ),
  })
  return !!row?.verifiedAt
}
