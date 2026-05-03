import crypto from "node:crypto"

const ALGO = "aes-256-gcm"
const IV_LEN = 12 // GCM recommended IV size

function loadKey(): Buffer {
  const raw = process.env.INSTANCE_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      "INSTANCE_ENCRYPTION_KEY is not set. Required for encrypting instance-scoped secrets."
    )
  }
  // Accept either 32-byte hex (64 chars) or 32-byte base64 (44 chars).
  let key: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex")
  } else {
    key = Buffer.from(raw, "base64")
  }
  if (key.length !== 32) {
    throw new Error(
      `INSTANCE_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Use 64 hex chars or 44 base64 chars.`
    )
  }
  return key
}

/**
 * Encrypt a plaintext string for storage. Output format:
 *   <base64(iv)>:<base64(ciphertext)>:<base64(authTag)>
 * Keys come from INSTANCE_ENCRYPTION_KEY. Uses AES-256-GCM.
 */
export function encryptSecret(plaintext: string): string {
  const key = loadKey()
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString("base64")}:${ciphertext.toString("base64")}:${authTag.toString("base64")}`
}

/** Decrypt a string produced by encryptSecret(). Throws on tampering or bad key. */
export function decryptSecret(payload: string): string {
  const parts = payload.split(":")
  if (parts.length !== 3) {
    throw new Error("decryptSecret: malformed payload; expected iv:ct:tag")
  }
  const [ivB64, ctB64, tagB64] = parts
  const key = loadKey()
  const iv = Buffer.from(ivB64, "base64")
  const ct = Buffer.from(ctB64, "base64")
  const tag = Buffer.from(tagB64, "base64")
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()])
  return plaintext.toString("utf8")
}
