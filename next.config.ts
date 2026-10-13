import { execSync } from "node:child_process"
import type { NextConfig } from "next"
import { withSentryConfig } from "@sentry/nextjs/config"

import { BRANDING } from "./src/configs/branding"

const brandHosts = [
  BRANDING.domain,
  `www.${BRANDING.domain}`,
  ...BRANDING.legacyHosts.site,
  ...BRANDING.legacyHosts.app,
]

const devOrigins = [
  ...brandHosts,
  ...(process.env.ALLOWED_DEV_ORIGINS?.split(",")
    .map((h) => h.trim())
    .filter(Boolean) ?? []),
]

// Paths that must NOT be redirected off a legacy host. Stripe and the Telegram
// Bot API do not follow redirects, so webhooks still pointed at the old
// hostname have to be served in place until they are re-registered; the
// PostHog reverse proxy (/ingest) must stay same-origin with the page that
// loaded it. Everything else 308s to the Atlas Agents domain.
const LEGACY_REDIRECT_EXCLUDED = ["api", "tg", "botapi", "ingest"]

/**
 * Permanent redirects from the pre-rename hosts to their Atlas Agents
 * equivalents, so old bookmarks and links keep working.
 *
 * Legacy *app* hosts go to this app's origin; legacy *site* hosts go to the
 * marketing site, so a stale marketing link doesn't land a logged-out visitor
 * in the dashboard. Returns [] when the app origin can't be resolved from env
 * (local dev), and skips any host that is already the canonical one.
 */
/**
 * Marketing paths this app answers for but does not own.
 *
 * The marketing site was extracted into its own repo; these routes forwarded
 * to it from here while `[APP]` still carried a duplicate copy of every page.
 * Those pages have since been deleted — the `(marketing)` route group, the root
 * `page.tsx`, and the components only they rendered are gone, archived in
 * `Landing-Old-Backup`. So these redirects are no longer a preference over
 * local pages; they are the only thing standing between these paths and a 404.
 *
 * Every path below exists on the marketing site, verified route-for-route at the
 * time of the extraction, so forwarding loses nothing. In-app links still point
 * at the bare paths (`/privacy` and `/terms` in the register form, `/refund`,
 * `/docs` from support, `/community` from the banned page) and reach the site
 * through here, so do not drop an entry without repointing its callers first.
 *
 * All temporary (307): these are a deployment-topology decision, not a
 * permanent URL change, and a cached 301 would be painful to walk back.
 */
const MARKETING_PATHS = [
  "/pricing",
  "/comparison",
  "/docs",
  "/community",
  "/careers",
  "/changelog",
  "/team",
  "/privacy",
  "/terms",
  "/refund",
  "/sla",
]

function marketingRedirects() {
  // `/` is not conditional on the marketing site resolving: on the dashboard
  // host the root belongs to the product, and there is no longer a root
  // `page.tsx` to fall back to. It stays internal — the proxy middleware
  // bounces anonymous visitors from /dashboard to /login.
  const root = { source: "/", destination: "/dashboard", permanent: false }

  const siteOrigin = (
    process.env.NEXT_PUBLIC_SITE_URL ?? BRANDING.siteUrl
  ).replace(/\/$/, "")

  // A malformed NEXT_PUBLIC_SITE_URL leaves nowhere to forward to. These paths
  // then 404 rather than redirect into the void; the pages that used to back
  // them no longer exist, so there is nothing to serve instead.
  let siteHost = ""
  try {
    siteHost = new URL(siteOrigin).hostname.toLowerCase()
  } catch {
    return [root]
  }
  if (!siteHost) return [root]

  return [
    root,
    ...MARKETING_PATHS.map((path) => ({
      source: path,
      destination: `${siteOrigin}${path}`,
      permanent: false,
    })),
  ]
}

function legacyHostRedirects() {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.AUTH_URL
  if (!raw) return []
  let appOrigin: string
  let canonicalHost: string
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`)
    appOrigin = u.origin
    canonicalHost = u.hostname.toLowerCase()
  } catch {
    return []
  }
  if (canonicalHost === "localhost" || canonicalHost.startsWith("127.")) return []

  const routes = [
    // PERMANENT (301). The dashboard is never coming back to app.sovereignml.com,
    // so caching this one is a feature.
    ...BRANDING.legacyHosts.app.map((host) => ({
      host,
      origin: appOrigin,
      permanent: true,
    })),
    // TEMPORARY (307), not 301. sovereignml.com is not being retired — it becomes
    // the SovereignML L.L.C. parent-company site. A 301 is cached by browsers more
    // or less forever, so anyone who hit the apex while this redirect was live
    // would keep being bounced to atlasagents.dev after the parent site exists,
    // and we would have burned the parent company's own domain. When that site
    // launches, drop this redirect — but NOT the BRANDING.legacyHosts entry:
    // src/lib/host.ts reuses that list to keep the domain unclaimable as a
    // white-label custom host.
    ...BRANDING.legacyHosts.site.map((host) => ({
      host,
      origin: BRANDING.siteUrl,
      permanent: false,
    })),
  ]

  return routes
    .filter(({ host }) => host.toLowerCase() !== canonicalHost)
    .map(({ host, origin, permanent }) => ({
      // `:path` captures the whole remaining path (`.*` spans slashes), so the
      // destination interpolates it as a single segment, not `:path*`.
      source: `/:path((?!${LEGACY_REDIRECT_EXCLUDED.join("|")}).*)`,
      has: [{ type: "host" as const, value: host }],
      destination: `${origin}/:path`,
      permanent,
    }))
}

function wwwToApexRedirect():
  | {
      source: string
      has: { type: "host"; value: string }[]
      destination: string
      permanent: boolean
    }
  | undefined {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.AUTH_URL
  if (!raw) return undefined
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`)
    const { hostname } = u
    if (
      hostname === "localhost" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("www.")
    ) {
      return undefined
    }
    return {
      source: "/:path*",
      has: [{ type: "host", value: `www.${hostname}` }],
      destination: `${u.origin}/:path*`,
      permanent: true,
    }
  } catch {
    return undefined
  }
}

/**
 * Sentry's CSP report endpoint, derived from the public DSN
 * (https://<key>@<host>/<project> → https://<host>/api/<project>/security/?sentry_key=<key>).
 */
function cspReportUri(): string | null {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
  if (!dsn) return null
  try {
    const u = new URL(dsn)
    const project = u.pathname.replace(/^\//, "")
    if (!u.username || !project) return null
    return `${u.protocol}//${u.host}/api/${project}/security/?sentry_key=${u.username}`
  } catch {
    return null
  }
}

/**
 * Content-Security-Policy. Ships in report-only mode: violations are reported
 * (to Sentry when NEXT_PUBLIC_SENTRY_DSN is set) without blocking anything.
 * Once the reports are clean, set CSP_ENFORCE=true at build to enforce it.
 *
 * Deliberately broad where the app needs it: Next.js App Router emits inline
 * scripts, so script-src keeps 'unsafe-inline' until a nonce-based policy
 * replaces it; a tenant's Chatwoot widget loads its script, iframe and
 * websocket from the tenant's own domain, hence https:/wss: in those lists.
 * The parts that matter today are object-src, base-uri, frame-ancestors and
 * form-action.
 */
function contentSecurityPolicy(): { key: string; value: string } {
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' https://challenges.cloudflare.com https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    // OAuth sign-in posts to /api/auth and is redirected to the provider;
    // browsers apply form-action to that redirect.
    "form-action 'self' https://accounts.google.com https://appleid.apple.com https://twitter.com https://x.com https://api.twitter.com https://checkout.stripe.com",
  ]
  const reportUri = cspReportUri()
  if (reportUri) directives.push(`report-uri ${reportUri}`)
  return {
    key:
      process.env.CSP_ENFORCE === "true"
        ? "Content-Security-Policy"
        : "Content-Security-Policy-Report-Only",
    value: directives.join("; "),
  }
}

const securityHeaders = [
  contentSecurityPolicy(),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
]

/**
 * The Sentry release: SENTRY_RELEASE when the deploy sets it, else the commit
 * being built. Inlined as NEXT_PUBLIC_SENTRY_RELEASE so the server, edge and
 * browser inits all tag events with the same build.
 */
function sentryRelease(): string | undefined {
  const explicit = process.env.SENTRY_RELEASE?.trim()
  if (explicit) return explicit
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim() || undefined
  } catch {
    return undefined
  }
}
const SENTRY_RELEASE = sentryRelease()

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: SENTRY_RELEASE ? { NEXT_PUBLIC_SENTRY_RELEASE: SENTRY_RELEASE } : {},
  output: "standalone",
  // PostHog proxy paths (/ingest/...) must not be trailing-slash redirected.
  skipTrailingSlashRedirect: true,
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
  serverExternalPackages: ["ssh2", "node-ssh", "cpu-features"],
  // Since 16.3, `next dev` appends a Next.js "agent rules" block to CLAUDE.md
  // whenever it detects an AI coding agent, and re-adds it if removed. This
  // repo's CLAUDE.md is curated and several agent sessions run dev servers in
  // parallel, so that would be a standing uncommitted change in every checkout.
  agentRules: false,
  images: {
    remotePatterns: [
      // Ghost illustration used by the ghost-404-page component
      { protocol: "https", hostname: "xubohuah.github.io" },
    ],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }]
  },
  async redirects() {
    const apex = wwwToApexRedirect()
    return [
      { source: "/signup", destination: "/register", permanent: false },
      // Host-scoped, so they must be evaluated BEFORE the host-agnostic
      // marketing rules below — Next.js takes the first match.
      ...legacyHostRedirects(),
      ...(apex ? [apex] : []),
      ...marketingRedirects(),
    ]
  },
  async rewrites() {
    // PostHog reverse proxy: browser events go to our own domain (/ingest) so
    // ad-blockers don't drop them. The /static/ rule must precede the
    // catch-all. See docs/POSTHOG.md.
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ]
  },
}

// Sentry build-time plugin: instruments the bundles and (only when
// SENTRY_AUTH_TOKEN + org/project are set) uploads source maps on build.
// Without those vars it's a no-op wrapper, so dev/CI builds are unaffected.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  ...(SENTRY_RELEASE ? { release: { name: SENTRY_RELEASE } } : {}),
  silent: !process.env.CI,
  // Keep client bundles lean; we don't proxy events through the app.
  widenClientFileUpload: false,
  // Strip the SDK's debug logging from the bundle (was `disableLogger`). Applies
  // to webpack builds only; Turbopack, the default, ignores it.
  webpack: { treeshake: { removeDebugLogging: true } },
})
