// Click-ID capture endpoint.
//
// The landing-page client (src/components/ad-click-capture.tsx) POSTs any
// fbclid/gclid it finds in the URL here, and we stash them in a first-party,
// httpOnly cookie. They're persisted onto the User row at signup and used by the
// server-side conversion senders later. See src/lib/ads/click-ids.
//
// Privacy: this is first-party technical storage only — nothing is transmitted
// to Meta/Google here. If the user has explicitly DECLINED marketing consent we
// skip storage entirely. Transmission to ad platforms is separately gated on
// granted consent at conversion time (src/lib/ads).

import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  AD_CLICK_COOKIE,
  AD_CLICK_MAX_AGE_SECONDS,
  parseAdClickCookie,
  serializeAdClickCookie,
} from "@/lib/ads/click-ids"
import { CONSENT_COOKIE, parseConsentCookie } from "@/lib/consent"

const MAX_LEN = 512

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const v = value.trim()
  if (!v || v.length > MAX_LEN) return undefined
  return v
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  const o = (body ?? {}) as Record<string, unknown>
  const fbclid = clean(o.fbclid)
  const gclid = clean(o.gclid)
  if (!fbclid && !gclid) {
    return NextResponse.json({ ok: true, stored: false })
  }

  const jar = await cookies()

  // Respect an explicit marketing opt-out: don't even store first-party.
  if (parseConsentCookie(jar.get(CONSENT_COOKIE)?.value)?.marketing === false) {
    return NextResponse.json({ ok: true, stored: false })
  }

  // Merge with any existing capture so we don't clobber a known click id with a
  // later page view that lacks it.
  const existing = parseAdClickCookie(jar.get(AD_CLICK_COOKIE)?.value)
  const merged = {
    fbclid: fbclid ?? existing?.fbclid,
    gclid: gclid ?? existing?.gclid,
    ts: existing?.ts ?? Date.now(),
  }

  jar.set(AD_CLICK_COOKIE, serializeAdClickCookie(merged), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AD_CLICK_MAX_AGE_SECONDS,
  })

  return NextResponse.json({ ok: true, stored: true })
}
