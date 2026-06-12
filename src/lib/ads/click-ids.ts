// Ad click-ID capture: the values that let a server-side conversion be matched
// back to the ad click that earned it.
//
//   fbclid — Meta's click id, present in landing URLs from Facebook/Instagram ads
//   gclid  — Google's click id, present in landing URLs from Google/YouTube ads
//
// These only exist in the browser URL when a user LANDS from an ad — long before
// they sign up or pay. We stash them in a first-party cookie on landing
// (src/app/api/ads/click) and persist them onto the User row at signup
// (src/app/api/auth/register), so the later purchase webhook — which has no
// browser context at all — can still attribute the conversion.

/** First-party cookie holding the captured click IDs. Not third-party shared. */
export const AD_CLICK_COOKIE = "sov_ad_click"

/** ~90 days — matches Meta's and Google's default click attribution windows. */
export const AD_CLICK_MAX_AGE_SECONDS = 90 * 24 * 60 * 60

export type AdClickIds = {
  fbclid?: string
  gclid?: string
  /** Epoch ms when first captured — used to construct Meta's `fbc`. */
  ts?: number
}

const MAX_CLICK_ID_LEN = 512

function cleanClickId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const v = value.trim()
  if (!v || v.length > MAX_CLICK_ID_LEN) return undefined
  return v
}

/** Parse the JSON cookie payload, tolerating absent/malformed values. */
export function parseAdClickCookie(raw: string | null | undefined): AdClickIds | null {
  if (!raw) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== "object") return null
  const o = obj as Record<string, unknown>
  const fbclid = cleanClickId(o.fbclid)
  const gclid = cleanClickId(o.gclid)
  const ts = typeof o.ts === "number" && Number.isFinite(o.ts) ? o.ts : undefined
  if (!fbclid && !gclid) return null
  return { fbclid, gclid, ts }
}

/** Serialize click IDs for the cookie value. */
export function serializeAdClickCookie(ids: AdClickIds): string {
  return JSON.stringify({ fbclid: ids.fbclid, gclid: ids.gclid, ts: ids.ts })
}

/**
 * Build Meta's `fbc` parameter from a raw fbclid.
 * Format: `fb.<subdomainIndex>.<creationTimeMs>.<fbclid>` — index 1 is the
 * conventional value for a domain-level cookie. Returns undefined without a
 * fbclid so the field is simply omitted from user_data.
 */
export function buildFbc(
  fbclid: string | null | undefined,
  capturedAtMs: number | null | undefined,
): string | undefined {
  const id = cleanClickId(fbclid)
  if (!id) return undefined
  const ts = typeof capturedAtMs === "number" && Number.isFinite(capturedAtMs)
    ? capturedAtMs
    : Date.now()
  return `fb.1.${ts}.${id}`
}

/** Pull a fresh set of click IDs out of a URL's query string. */
export function clickIdsFromSearchParams(params: URLSearchParams): AdClickIds | null {
  const fbclid = cleanClickId(params.get("fbclid"))
  const gclid = cleanClickId(params.get("gclid"))
  if (!fbclid && !gclid) return null
  return { fbclid, gclid, ts: Date.now() }
}
