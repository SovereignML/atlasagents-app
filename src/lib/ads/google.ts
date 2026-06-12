// Google Ads server-side conversions via the Data Manager API.
//
// NOTE: this deliberately targets the Data Manager API (events:ingest), NOT the
// older Google Ads API UploadClickConversions endpoint — Google began
// deprecating UploadClickConversions on 2026-06-15 in favour of Data Manager.
//
//   Endpoint: POST datamanager.googleapis.com/v1/events:ingest
//   Auth:     OAuth2 via a service account, scope ".../auth/datamanager"
//   Docs:     https://developers.google.com/data-manager/api
//
// No-op when unconfigured (service-account JSON + operating account + a
// per-event destination must all be present), mirroring meta.ts.

import { GoogleAuth } from "google-auth-library"
import { hashEmail } from "./hash"

const SCOPE = "https://www.googleapis.com/auth/datamanager"
const INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest"

// Service-account key JSON. Accepts either raw JSON or base64-encoded JSON so it
// survives single-line .env files.
const SA_RAW = process.env.GOOGLE_DM_SERVICE_ACCOUNT_JSON?.trim()
// The Google Ads customer id receiving the conversion (digits only, no dashes).
const OPERATING_ACCOUNT_ID = process.env.GOOGLE_ADS_CUSTOMER_ID?.trim()
// Manager (MCC) account id, when the SA authenticates through a manager.
const LOGIN_ACCOUNT_ID = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim() || undefined

export const googleEnabled = !!(SA_RAW && OPERATING_ACCOUNT_ID)

function decodeServiceAccount(raw: string): Record<string, unknown> | null {
  // Try raw JSON first, then base64.
  for (const candidate of [raw, safeBase64Decode(raw)]) {
    if (!candidate) continue
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === "object") return parsed
    } catch {
      // fall through
    }
  }
  return null
}

function safeBase64Decode(raw: string): string | null {
  try {
    return Buffer.from(raw, "base64").toString("utf8")
  } catch {
    return null
  }
}

let authClient: GoogleAuth | null = null
function getAuth(): GoogleAuth | null {
  if (!SA_RAW) return null
  if (!authClient) {
    const credentials = decodeServiceAccount(SA_RAW)
    if (!credentials) return null
    authClient = new GoogleAuth({ credentials, scopes: [SCOPE] })
  }
  return authClient
}

export type GoogleConversion = {
  /** Which conversion this maps to → the Data Manager destination id. */
  destinationId: string
  /** Idempotency key (Stripe session / user id based). */
  transactionId: string
  /** Unix seconds. */
  eventTime: number
  email?: string | null
  gclid?: string | null
  /** Not available for webhook-sourced events (no browser). */
  clientIp?: string | null
  clientUserAgent?: string | null
  value?: number | null
  currency?: string | null
}

/**
 * Ingest one conversion event. Throws on non-2xx so the caller can log; the
 * public facade swallows it. No-op when Google isn't configured or the event
 * carries no destination.
 */
export async function sendGoogleConversion(e: GoogleConversion): Promise<void> {
  if (!googleEnabled || !e.destinationId) return

  const auth = getAuth()
  if (!auth) return
  const token = await auth.getAccessToken()
  if (!token) throw new Error("Google Data Manager: failed to mint access token")

  const userIdentifiers: Array<Record<string, string>> = []
  const em = hashEmail(e.email)
  if (em) userIdentifiers.push({ emailAddress: em })

  const event: Record<string, unknown> = {
    transactionId: e.transactionId,
    eventTimestamp: new Date(e.eventTime * 1000).toISOString(),
    eventSource: "WEB",
    ...(e.gclid ? { adIdentifiers: { gclid: e.gclid } } : {}),
    ...(userIdentifiers.length ? { userData: { userIdentifiers } } : {}),
    ...(e.value != null
      ? { conversionValue: e.value, currency: (e.currency || "USD").toUpperCase() }
      : {}),
    ...(e.clientIp || e.clientUserAgent
      ? {
          eventDeviceInfo: {
            ...(e.clientIp ? { ipAddress: e.clientIp } : {}),
            ...(e.clientUserAgent ? { userAgent: e.clientUserAgent } : {}),
          },
        }
      : {}),
  }

  const body = {
    destinations: [
      {
        operatingAccount: { accountType: "GOOGLE_ADS", accountId: OPERATING_ACCOUNT_ID },
        ...(LOGIN_ACCOUNT_ID
          ? { loginAccount: { accountType: "GOOGLE_ADS", accountId: LOGIN_ACCOUNT_ID } }
          : {}),
        productDestinationId: e.destinationId,
      },
    ],
    events: [event],
    // We only ever reach this point with marketing consent granted (enforced by
    // the facade), so the per-request consent signal is GRANTED.
    consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" },
    encoding: "HEX",
  }

  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`Google Data Manager ${res.status}: ${detail.slice(0, 500)}`)
  }
}
