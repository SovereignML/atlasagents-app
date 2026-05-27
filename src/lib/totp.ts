// RFC 6238 TOTP + RFC 4648 Base32, implemented on top of node:crypto.
//
// No external deps. The accept window defaults to ±1 step (±30s) so brief
// clock drift on the authenticator app is tolerated without dramatically
// widening the brute-force surface (a 6-digit code with a 3-step window
// is still 1 in ~333k per attempt — combine with rate limiting on the
// signin endpoint).

import crypto from "node:crypto"

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function generateBase32Secret(byteLength = 20): string {
  const bytes = crypto.randomBytes(byteLength)
  return base32Encode(bytes)
}

export function base32Encode(buf: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ""
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f]
  }
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) {
      throw new Error(`Invalid base32 character: ${ch}`)
    }
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/**
 * Generate a 6-digit TOTP token for a given step counter. Implementation
 * follows the HOTP/TOTP reference in RFC 4226 §5.3 + RFC 6238 §4.
 */
function generateHotpToken(secret: Buffer, counter: number, digits = 6): string {
  const counterBuf = Buffer.alloc(8)
  // Counter is 8 bytes big-endian — only the lower 32 bits are needed for
  // any plausible time horizon, the upper bits stay zero.
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  counterBuf.writeUInt32BE(counter & 0xffffffff, 4)

  const hmac = crypto.createHmac("sha1", secret).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  const code = binary % 10 ** digits
  return code.toString().padStart(digits, "0")
}

export interface TotpVerifyOptions {
  /** Step size in seconds. Default 30 (matches Google Authenticator / Authy). */
  step?: number
  /** ± window of steps to accept. Default 1 (±30s). */
  window?: number
  /** Number of digits (default 6). */
  digits?: number
}

export function generateTotpToken(
  base32Secret: string,
  opts: TotpVerifyOptions & { now?: number } = {},
): string {
  const step = opts.step ?? 30
  const digits = opts.digits ?? 6
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const counter = Math.floor(now / step)
  return generateHotpToken(base32Decode(base32Secret), counter, digits)
}

/**
 * Constant-time string compare. Both strings must already have the same
 * length — we only ever compare 6-digit numeric tokens, so that's safe.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export function verifyTotpToken(
  token: string,
  base32Secret: string,
  opts: TotpVerifyOptions & { now?: number } = {},
): boolean {
  const step = opts.step ?? 30
  const window = opts.window ?? 1
  const digits = opts.digits ?? 6

  const normalized = token.replace(/\s+/g, "")
  if (!/^\d+$/.test(normalized) || normalized.length !== digits) return false

  let secret: Buffer
  try {
    secret = base32Decode(base32Secret)
  } catch {
    return false
  }

  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const baseCounter = Math.floor(now / step)
  for (let i = -window; i <= window; i++) {
    const counter = baseCounter + i
    if (counter < 0) continue
    const candidate = generateHotpToken(secret, counter, digits)
    if (safeEqual(candidate, normalized)) return true
  }
  return false
}

/**
 * Build an otpauth:// URI suitable for QR-code enrollment in Google
 * Authenticator, 1Password, Authy, etc.
 */
export function buildOtpauthUri(params: {
  secret: string
  accountName: string
  issuer: string
  digits?: number
  period?: number
  algorithm?: "SHA1" | "SHA256" | "SHA512"
}): string {
  const { secret, accountName, issuer } = params
  const digits = params.digits ?? 6
  const period = params.period ?? 30
  const algorithm = params.algorithm ?? "SHA1"

  const label = encodeURIComponent(`${issuer}:${accountName}`)
  const search = new URLSearchParams({
    secret,
    issuer,
    algorithm,
    digits: String(digits),
    period: String(period),
  })
  return `otpauth://totp/${label}?${search.toString()}`
}
