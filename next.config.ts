import type { NextConfig } from "next"
import { withSentryConfig } from "@sentry/nextjs"

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

const securityHeaders = [
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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // PostHog proxy paths (/ingest/...) must not be trailing-slash redirected.
  skipTrailingSlashRedirect: true,
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
  serverExternalPackages: ["ssh2", "node-ssh", "cpu-features"],
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
      ...legacyHostRedirects(),
      ...(apex ? [apex] : []),
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
  silent: !process.env.CI,
  // Keep client bundles lean; we don't proxy events through the app.
  widenClientFileUpload: false,
  disableLogger: true,
})
