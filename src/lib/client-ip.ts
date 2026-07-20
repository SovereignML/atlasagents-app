/**
 * Client IP for rate-limit keys and audit logs.
 *
 * Trust order:
 *   1. `cf-connecting-ip` — set by Cloudflare on every proxied request and
 *      not forwardable by clients through Cloudflare. Production ingress is
 *      Cloudflare, so this is the authentic address.
 *   2. Rightmost `x-forwarded-for` hop — appended by the nearest proxy;
 *      unlike the leftmost entry it is not attacker-chosen (an attacker can
 *      prepend, not replace the hop their connection actually came from).
 *   3. "unknown" — never return an empty string; limiter keys must be stable.
 *
 * Accepts a Headers-like object so it works in both route handlers
 * (`req.headers`) and the NextAuth authorize callback (`request?.headers`).
 */
export function clientIp(
  headers: { get(name: string): string | null } | undefined,
): string {
  if (!headers) return "unknown"
  const cf = headers.get("cf-connecting-ip")?.trim()
  if (cf) return cf
  const xff = headers.get("x-forwarded-for")
  if (xff) {
    const hops = xff.split(",").map((h) => h.trim()).filter(Boolean)
    const last = hops[hops.length - 1]
    if (last) return last
  }
  return "unknown"
}
