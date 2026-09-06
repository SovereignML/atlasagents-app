// Single source of truth for product identity. Edit here, propagates everywhere.
//
// This file is intentionally byte-identical to sovereignml-web/src/configs/branding.ts.
// If you change one, change the other in the same pass — nothing enforces it.

export const BRANDING = {
  name: "Atlas Agents",
  shortName: "Atlas",
  tagline: "Launch. Automate. Scale.",
  subtagline: "Your AI workforce, deployed and managed.",
  description:
    "Atlas Agents is the AI operations platform for deploying intelligent agents — built on open agent runtimes like OpenClaw and Hermes — that do real work. Launch AI agents in minutes, automate business operations, and scale your AI workforce with your own isolated instances and no single-vendor lock-in.",
  domain: "atlasagents.dev",
  // Full legal entity for use in legal pages (Terms, Privacy, Refund, SLA)
  // contact blocks, footers, and governing-law clauses. Marketing/nav copy
  // continues to use `name`.
  //
  // The entity is deliberately NOT renamed: SovereignML L.L.C. remains the
  // registered company, and sovereignml.com is becoming the parent-company
  // site. "Atlas Agents" is the product operated by that entity.
  legalEntity: "SovereignML L.L.C.",
  jurisdiction: "North Carolina, USA",
  // Hosts served before the Atlas Agents rename. They stay canonical — so they
  // can't be claimed as white-label custom domains (src/lib/host.ts) — and are
  // redirected in next.config.ts. Split by destination: `site` hosts belong to
  // the marketing site, `app` hosts to the dashboard, so a stale marketing
  // bookmark doesn't dump the visitor in the dashboard.
  //
  // The two halves redirect differently ON PURPOSE:
  //   - `app` → 301. The dashboard is never returning to app.sovereignml.com.
  //   - `site` → 307. sovereignml.com is NOT being retired; it becomes the
  //     SovereignML L.L.C. parent-company site. A 301 would be cached by
  //     browsers indefinitely and would keep sending visitors away from that
  //     site once it exists.
  //
  // Do NOT delete entries from this list to "retire" a redirect — removing a
  // host here also drops it from canonicalHosts() in src/lib/host.ts, which is
  // what stops a reseller claiming it as their own custom domain. Retire the
  // redirect in next.config.ts and leave the host listed here.
  legacyHosts: {
    site: ["sovereignml.com", "www.sovereignml.com"],
    app: ["app.sovereignml.com"],
  },
  legacyName: "SovereignML",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://atlasagents.dev",
  supportEmail: "support@atlasagents.dev",
  noreplyEmail: "noreply@atlasagents.dev",
  billingEmail: "billing@atlasagents.dev",
  securityEmail: "security@atlasagents.dev",
  privacyEmail: "privacy@atlasagents.dev",
  legalEmail: "legal@atlasagents.dev",
  github: "https://github.com/sovereignml", // {{TODO: Atlas Agents GitHub org}}
  twitter: "https://twitter.com/sovereignml", // {{TODO: Atlas Agents handle}}
  linkedin: "https://linkedin.com/company/sovereignml", // {{TODO: Atlas Agents page}}
  telegram: "#", // {{TODO: real Telegram invite URL}}
  demoUrl: "https://tidycal.com/sovereignml/demo", // {{TODO: Atlas Agents booking link}}
  positioning: {
    headline: "Others give you tools. Atlas Agents gives you agents that work.",
    bullets: [
      "Deploy on open runtimes — OpenClaw & Hermes — no lock-in",
      "Monitor performance and health in real time",
      "Scale from one agent to an entire AI workforce",
    ],
  },
} as const

export type Branding = typeof BRANDING
