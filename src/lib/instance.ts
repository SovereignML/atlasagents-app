// Helpers for the Instance domain: slug generation, AES-256-GCM encryption
// for root passwords, mock IP generation, SSH key fingerprinting.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto"

// ---------- Slugs ----------

export function createSlug(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  const suffix = randomBytes(3).toString("hex")
  return base ? `${base}-${suffix}` : `instance-${suffix}`
}

// ---------- Encryption ----------
// Format: base64(iv:12 || authTag:16 || ciphertext)

const ALG = "aes-256-gcm"

function getKey(): Buffer {
  const raw = process.env.INSTANCE_ENCRYPTION_KEY
  if (!raw) {
    // Dev fallback: deterministic dev key. NEVER use in prod.
    if (process.env.NODE_ENV === "production") {
      throw new Error("INSTANCE_ENCRYPTION_KEY is required in production")
    }
    return createHash("sha256").update("sovereignml-dev-key").digest()
  }
  const buf = Buffer.from(raw, "base64")
  if (buf.length !== 32) {
    throw new Error("INSTANCE_ENCRYPTION_KEY must be 32 bytes (base64-encoded)")
  }
  return buf
}

export function encryptRootPassword(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, getKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString("base64")
}

export function decryptRootPassword(encoded: string): string {
  const buf = Buffer.from(encoded, "base64")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct = buf.subarray(28)
  const decipher = createDecipheriv(ALG, getKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")
}

// ---------- Mock IP ----------

export function generateMockIp(): string {
  // Reserved test range 192.0.2.0/24 — guaranteed not to collide with real infra.
  const last = Math.floor(Math.random() * 254) + 1
  return `192.0.2.${last}`
}

// ---------- SSH key fingerprint ----------

export function computeSshFingerprint(publicKey: string): string {
  // Standard OpenSSH SHA256 fingerprint format:
  // SHA256:base64(sha256(decoded_key_blob))
  const trimmed = publicKey.trim()
  const parts = trimmed.split(/\s+/)
  if (parts.length < 2) return "SHA256:invalid"
  try {
    const blob = Buffer.from(parts[1], "base64")
    const hash = createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")
    return `SHA256:${hash}`
  } catch {
    return "SHA256:invalid"
  }
}

export function isValidPublicKey(publicKey: string): boolean {
  const trimmed = publicKey.trim()
  return /^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-nistp(256|384|521))\s+\S+/.test(trimmed)
}
