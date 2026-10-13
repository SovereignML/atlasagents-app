// Cookie-consent endpoint.
//
// POST records the user's consent decision in a first-party cookie and, when a
// session exists, persists it onto the User row so the Stripe purchase webhook
// (which never sees the cookie) can honor it. GET returns the current decision.

import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { auth } from "@/auth"
import { db, users, eq } from "@/db"
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  parseConsentCookie,
  serializeConsentCookie,
} from "@/lib/consent"
import { readJsonBody } from "@/lib/request-body"
import { consentSchema } from "@/lib/validations"

export async function GET() {
  const jar = await cookies()
  return NextResponse.json({ consent: parseConsentCookie(jar.get(CONSENT_COOKIE)?.value) })
}

export async function POST(req: Request) {
  const parsed = await readJsonBody(req, consentSchema)
  if (!parsed.ok) return parsed.res

  const state = {
    marketing: parsed.data.marketing,
    analytics: parsed.data.analytics ?? false,
    ts: Date.now(),
  }

  const jar = await cookies()
  jar.set(CONSENT_COOKIE, serializeConsentCookie(state), {
    httpOnly: false, // read client-side by the consent banner; carries no PII
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CONSENT_MAX_AGE_SECONDS,
  })

  // Best-effort: persist onto the logged-in user so server-side conversions
  // (Stripe webhook) can read the decision. Never fail the request over it.
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (userId) {
      await db
        .update(users)
        .set({ marketingConsent: state.marketing, consentUpdatedAt: new Date() })
        .where(eq(users.id, userId))
    }
  } catch (err) {
    console.error("[consent] failed to persist to user:", err)
  }

  return NextResponse.json({ ok: true, consent: state })
}
