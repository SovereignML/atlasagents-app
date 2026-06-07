/**
 * Cloudflare Turnstile bot-protection helpers.
 *
 * Env-driven and gracefully degrading, mirroring src/lib/oauth.ts and the
 * `if (!resend)` pattern in src/lib/email.ts: when the keys are unset (dev /
 * local), the widget renders nothing and `verifyTurnstileToken` returns true,
 * so the auth forms keep working without Turnstile configured.
 *
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY — public site key (also read client-side)
 *   TURNSTILE_SECRET_KEY           — server-only secret for siteverify
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

export function isTurnstileConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() &&
      process.env.TURNSTILE_SECRET_KEY?.trim(),
  )
}

/**
 * Verify a Turnstile token against Cloudflare. Returns true (skip) when
 * Turnstile isn't configured, false when configured but the token is missing
 * or rejected. `ip` is the client IP (optional — siteverify works without it).
 */
export async function verifyTurnstileToken(
  token: string | undefined | null,
  ip?: string,
): Promise<boolean> {
  if (!isTurnstileConfigured()) return true
  if (!token) return false

  try {
    const body = new URLSearchParams()
    body.set("secret", process.env.TURNSTILE_SECRET_KEY!)
    body.set("response", token)
    if (ip) body.set("remoteip", ip)

    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch (err) {
    console.error("[turnstile] siteverify failed:", err)
    return false
  }
}
