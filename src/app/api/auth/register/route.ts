import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { db, users, eq } from "@/db"
import { hashPassword } from "@/lib/password"
import { registerSchema } from "@/lib/validations"
import { rateLimit } from "@/lib/rate-limit"
import { resolveTeamByHost } from "@/lib/tenant-branding"
import { getTenantConfig, createChildTeam } from "@/lib/tenant"
import { verifyTurnstileToken } from "@/lib/turnstile"
import { issueAndSendVerification } from "@/lib/email-verification"
import { posthogServer } from "@/lib/posthog-server"
import { adsConversions } from "@/lib/ads"
import { AD_CLICK_COOKIE, parseAdClickCookie } from "@/lib/ads/click-ids"
import { CONSENT_COOKIE, parseConsentCookie } from "@/lib/consent"
import { clientIp } from "@/lib/client-ip"

export async function POST(req: Request) {
  try {
    const ip = clientIp(req.headers)
    if (!(await rateLimit(`register:${ip}`, 5, 60 * 60 * 1000))) {
      return NextResponse.json(
        { error: "Too many registration attempts. Try again later." },
        { status: 429 }
      )
    }

    const body = await req.json()

    // Turnstile is verified off the raw body (not part of registerSchema, which
    // only models user data). No-op when Turnstile isn't configured.
    if (!(await verifyTurnstileToken(body?.turnstileToken, ip === "unknown" ? undefined : ip))) {
      return NextResponse.json(
        { error: "Verification failed. Please try again." },
        { status: 400 }
      )
    }

    const result = registerSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 }
      )
    }

    const { name, email, password } = result.data

    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    })

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      )
    }

    const [newUser] = await db
      .insert(users)
      .values({
        name,
        email,
        hashedPassword: await hashPassword(password),
      })
      .returning({ id: users.id })

    // Fire-and-forget analytics; no-op when PostHog isn't configured.
    if (newUser) {
      posthogServer.capture({
        distinctId: newUser.id,
        event: "user_signed_up",
        properties: { method: "credentials" },
      })

      // Ad-conversion attribution. Persist the click IDs captured on landing and
      // the consent decision onto the user (so the later purchase webhook can
      // read them), then fire the signup conversion. All best-effort and gated
      // on marketing consent — no-op when ads/consent aren't configured/granted.
      try {
        const jar = await cookies()
        const clickIds = parseAdClickCookie(jar.get(AD_CLICK_COOKIE)?.value)
        const consent = parseConsentCookie(jar.get(CONSENT_COOKIE)?.value)
        const marketingConsent = consent?.marketing ?? null

        if (clickIds || marketingConsent !== null) {
          await db
            .update(users)
            .set({
              fbclid: clickIds?.fbclid ?? null,
              gclid: clickIds?.gclid ?? null,
              adClickCapturedAt: clickIds?.ts ? new Date(clickIds.ts) : null,
              marketingConsent,
              consentUpdatedAt: consent ? new Date() : null,
            })
            .where(eq(users.id, newUser.id))
        }

        adsConversions.trackSignup({
          userId: newUser.id,
          email,
          consent: marketingConsent === true,
          clickIds: {
            fbclid: clickIds?.fbclid,
            gclid: clickIds?.gclid,
            capturedAtMs: clickIds?.ts,
          },
          clientIp: ip === "unknown" ? null : ip,
          clientUserAgent: req.headers.get("user-agent"),
          sourceUrl: req.headers.get("referer"),
        })
      } catch (err) {
        console.error("[register] ad-conversion tracking failed:", err)
      }
    }

    // Self-serve white-label signup: if this registration happened on a tenant's
    // verified custom domain, attach the new account as a child team under that
    // tenant. On the canonical host (or any non-tenant domain) this is a no-op —
    // the user gets a personal team lazily on first login (getUserTeam).
    try {
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
      const tenantTeamId = newUser ? await resolveTeamByHost(host) : null
      // Only attach under a real reseller tenant (resolveTeamByHost returns the
      // domain owner; confirm it actually runs a reseller tenant).
      const cfg = tenantTeamId ? await getTenantConfig(tenantTeamId) : null
      if (tenantTeamId && newUser && cfg) {
        const child = await createChildTeam({
          parentTeamId: tenantTeamId,
          name: `${name}'s account`,
          ownerUserId: newUser.id,
          agentLimit: cfg?.defaultChildAgentLimit,
          seatLimit: cfg?.defaultChildSeatLimit,
        })
        await db
          .update(users)
          .set({ activeTeamId: child.id })
          .where(eq(users.id, newUser.id))
      }
    } catch (err) {
      // Never fail registration over tenant attachment — log and continue; the
      // account exists and can be re-attached by the tenant admin if needed.
      console.error("[register] tenant attach failed:", err)
    }

    // Issue an email-verification token and send the link. Best-effort — never
    // fail the signup over email delivery; the user can resend from the
    // dashboard banner. `emailVerified` stays null until they click the link.
    try {
      await issueAndSendVerification(email)
    } catch (err) {
      console.error("[register] verification email failed:", err)
    }

    return NextResponse.json(
      { message: "Account created successfully" },
      { status: 201 }
    )
  } catch {
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    )
  }
}
