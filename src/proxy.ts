import { auth } from "@/auth"

/**
 * Next.js 16+ uses `proxy.ts` for this edge entry (see middleware-to-proxy).
 * Must use the same `auth` as API routes so the session cookie decodes here.
 * A separate `NextAuth(authConfig)` instance left `req.auth` null in production
 * while `/api/auth/*` still worked — dashboard URLs then showed `/login`.
 */
export default auth

// Defense-in-depth: protected API routes already call `await auth()` themselves.
// This matcher is a backstop for routes that forget. Critical exclusions:
//   - /api/auth/*    NextAuth's own login/callback/session routes
//   - /api/webhooks/* signature-verified, not session-auth (Stripe etc.)
//   - /tg/*, /g/*    botToken-auth, not session-auth
//   - /api/usage/*   botToken-auth (bot runtime callers don't have a session)
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/tenant-admin/:path*",
    "/login",
    "/register",
    "/api/admin/:path*",
    "/api/tenant-admin/:path*",
    "/api/instances/:path*",
    "/api/team/:path*",
    "/api/billing/:path*",
    "/api/dashboard/:path*",
    "/api/audit-log/:path*",
  ],
}
