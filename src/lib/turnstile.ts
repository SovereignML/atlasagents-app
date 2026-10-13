/**
 * Cloudflare Turnstile bot-protection helpers.
 *
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY — public site key (also read client-side)
 *   TURNSTILE_SECRET_KEY           — server-only secret for siteverify
 *   TURNSTILE_DISABLED             — "true" to run production without it, on purpose
 *
 * Fails closed in production. Missing keys used to make verification return
 * true, so a deploy that lost them quietly dropped the bot check from the
 * login, register and forgot-password forms. Now production needs either both
 * keys or an explicit TURNSTILE_DISABLED=true: assertEnv() refuses to boot
 * otherwise, and verifyTurnstileToken() rejects every token. Outside
 * production, unset keys still skip the check so local forms work.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

export function isTurnstileConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() &&
      process.env.TURNSTILE_SECRET_KEY?.trim(),
  )
}

/** True when Turnstile may be skipped because it isn't configured: dev, or an explicit opt-out. */
export function mayRunWithoutTurnstile(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.TURNSTILE_DISABLED?.trim().toLowerCase() === "true"
  )
}

/**
 * Verify a Turnstile token against Cloudflare. False when the token is missing
 * or rejected. When Turnstile isn't configured: true (skip) in dev or with
 * TURNSTILE_DISABLED=true, false otherwise. `ip` is the client IP (optional —
 * siteverify works without it).
 */
export async function verifyTurnstileToken(
  token: string | undefined | null,
  ip?: string,
): Promise<boolean> {
  if (!isTurnstileConfigured()) {
    if (mayRunWithoutTurnstile()) return true
    console.error(
      "[turnstile] keys are not set in production and TURNSTILE_DISABLED is not true — rejecting.",
    )
    return false
  }
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
