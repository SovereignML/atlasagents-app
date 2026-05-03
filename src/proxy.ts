import { auth } from "@/auth"

/**
 * Next.js 16+ uses `proxy.ts` for this edge entry (see middleware-to-proxy).
 * Must use the same `auth` as API routes so the session cookie decodes here.
 * A separate `NextAuth(authConfig)` instance left `req.auth` null in production
 * while `/api/auth/*` still worked — dashboard URLs then showed `/login`.
 */
export default auth

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/login", "/register"],
}
