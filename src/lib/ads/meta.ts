// Meta Conversions API (server-side) client.
//
// Posts conversion events directly to Meta's Graph API — no browser pixel, so
// ad-blockers and ITP can't drop them. No-op when the pixel id / access token
// are unset (mirrors the PostHog/Sentry "safe without env" pattern), so call
// sites never branch on whether tracking is configured.
//
//   Endpoint: POST graph.facebook.com/<version>/<pixelId>/events?access_token=
//   Docs:     https://developers.facebook.com/docs/marketing-api/conversions-api

import { hashEmail } from "./hash"
import { buildFbc } from "./click-ids"

const PIXEL_ID = process.env.META_PIXEL_ID?.trim()
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN?.trim()
const API_VERSION = process.env.META_GRAPH_API_VERSION?.trim() || "v21.0"
// Optional: routes events to Test Events in Events Manager instead of production.
const TEST_EVENT_CODE = process.env.META_CAPI_TEST_EVENT_CODE?.trim() || undefined

export const metaEnabled = !!(PIXEL_ID && ACCESS_TOKEN)

export type MetaConversion = {
  /** Standard event name, e.g. "CompleteRegistration" or "Purchase". */
  eventName: string
  /** Idempotency / dedup key, shared with any future browser pixel event. */
  eventId: string
  /** Unix seconds. */
  eventTime: number
  email?: string | null
  fbclid?: string | null
  /** Epoch ms the fbclid was captured — used to construct `fbc`. */
  fbclidCapturedAtMs?: number | null
  /** Not available for webhook-sourced events (no browser). */
  clientIp?: string | null
  clientUserAgent?: string | null
  sourceUrl?: string | null
  value?: number | null
  currency?: string | null
}

/**
 * Send one event to the Conversions API. Throws on a non-2xx response so the
 * caller can log it; the public adsConversions facade swallows the error
 * (fire-and-forget). Does nothing when Meta isn't configured.
 */
export async function sendMetaConversion(e: MetaConversion): Promise<void> {
  if (!metaEnabled) return

  const user_data: Record<string, unknown> = {}
  const em = hashEmail(e.email)
  if (em) user_data.em = [em]
  if (e.clientIp) user_data.client_ip_address = e.clientIp
  if (e.clientUserAgent) user_data.client_user_agent = e.clientUserAgent
  const fbc = buildFbc(e.fbclid, e.fbclidCapturedAtMs)
  if (fbc) user_data.fbc = fbc

  const custom_data =
    e.value != null
      ? { value: e.value, currency: (e.currency || "USD").toUpperCase() }
      : undefined

  const body = {
    data: [
      {
        event_name: e.eventName,
        event_time: e.eventTime,
        event_id: e.eventId,
        action_source: "website",
        ...(e.sourceUrl ? { event_source_url: e.sourceUrl } : {}),
        user_data,
        ...(custom_data ? { custom_data } : {}),
      },
    ],
    ...(TEST_EVENT_CODE ? { test_event_code: TEST_EVENT_CODE } : {}),
  }

  const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(
    ACCESS_TOKEN!,
  )}`

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`Meta CAPI ${res.status}: ${detail.slice(0, 500)}`)
  }
}
