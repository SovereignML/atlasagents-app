// PII normalization + SHA-256 hashing for ad-conversion matching.
//
// Both Meta CAPI and Google's Data Manager API match users on SHA-256 hashes
// of normalized personal data (lowercased/trimmed email, etc.), hex-encoded.
// Raw PII is NEVER sent — only these digests. See src/lib/ads/index.ts.

import { createHash } from "node:crypto"

/** SHA-256 hex digest of an already-normalized value. Empty input → undefined. */
export function sha256Hex(value: string | null | undefined): string | undefined {
  const v = value?.trim()
  if (!v) return undefined
  return createHash("sha256").update(v).digest("hex")
}

/**
 * Normalize then hash an email address per Meta/Google rules: trim surrounding
 * whitespace and lowercase. Returns undefined for missing/blank emails so call
 * sites can simply omit the identifier.
 */
export function hashEmail(email: string | null | undefined): string | undefined {
  const normalized = email?.trim().toLowerCase()
  return sha256Hex(normalized)
}
