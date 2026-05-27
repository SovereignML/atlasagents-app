// 2FA orchestration helpers — sit between the API handlers and the DB,
// and hold the policy decisions (backup-code format, secret encryption,
// constant-time comparisons) that we don't want spread across handlers.

import crypto from "node:crypto"

import { db, users, eq } from "@/db"
import { decryptSecret, encryptSecret } from "@/lib/crypto-secret"
import { hashPassword, verifyPassword } from "@/lib/password"
import {
  buildOtpauthUri,
  generateBase32Secret,
} from "@/lib/totp"

const BACKUP_CODE_COUNT = 10
const BACKUP_CODE_BYTES = 5 // → 10 hex chars

export interface TwoFactorSetup {
  /** Plaintext base32 secret — only ever returned to the user during enroll. */
  secret: string
  /** otpauth:// URI for QR-code rendering. */
  otpauthUri: string
}

export function createTwoFactorSetup(params: {
  accountName: string
  issuer?: string
}): TwoFactorSetup {
  const secret = generateBase32Secret()
  const otpauthUri = buildOtpauthUri({
    secret,
    accountName: params.accountName,
    issuer: params.issuer ?? "SovereignML",
  })
  return { secret, otpauthUri }
}

/**
 * Encrypt the base32 secret for at-rest storage. We reuse the existing
 * `INSTANCE_ENCRYPTION_KEY` AES-256-GCM helper so we don't introduce yet
 * another key.
 */
export function encryptTotpSecret(plain: string): string {
  return encryptSecret(plain)
}

export function decryptTotpSecret(stored: string): string {
  return decryptSecret(stored)
}

/**
 * Generate a fresh set of human-friendly backup codes formatted as
 * `XXXXX-XXXXX`. Returns both the plaintext list (shown once to the user)
 * and bcrypt hashes (stored in the DB).
 */
export async function generateBackupCodes(): Promise<{
  plaintext: string[]
  hashed: string[]
}> {
  const plaintext: string[] = []
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const raw = crypto.randomBytes(BACKUP_CODE_BYTES).toString("hex").toUpperCase()
    plaintext.push(`${raw.slice(0, 5)}-${raw.slice(5)}`)
  }
  const hashed = await Promise.all(plaintext.map((code) => hashPassword(code)))
  return { plaintext, hashed }
}

function normalizeBackupCode(input: string): string {
  return input.replace(/\s+/g, "").replace(/-/g, "").toUpperCase()
}

/**
 * Attempt to consume a backup code. Returns true if a stored hash matched —
 * the matching hash is removed from the user's list so the code can't be
 * reused.
 */
export async function consumeBackupCode(
  userId: string,
  rawCode: string,
): Promise<boolean> {
  const candidate = normalizeBackupCode(rawCode)
  // Backup codes are 10 hex chars (5 bytes) — require at least that to bother.
  if (!/^[0-9A-F]{10}$/.test(candidate)) return false

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { twoFactorBackupCodes: true },
  })
  const codes = user?.twoFactorBackupCodes
  if (!codes || codes.length === 0) return false

  const formatted = `${candidate.slice(0, 5)}-${candidate.slice(5)}`

  for (let i = 0; i < codes.length; i++) {
    const matches = await verifyPassword(formatted, codes[i])
    if (matches) {
      const remaining = codes.filter((_, j) => j !== i)
      await db
        .update(users)
        .set({ twoFactorBackupCodes: remaining })
        .where(eq(users.id, userId))
      return true
    }
  }
  return false
}
