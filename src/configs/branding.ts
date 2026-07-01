// Single source of truth for product identity. Edit here, propagates everywhere.

export const BRANDING = {
  name: "SovereignML",
  shortName: "SovereignML",
  tagline: "Launch. Automate. Scale.",
  subtagline: "Your AI workforce, deployed and managed.",
  description:
    "SovereignML is the AI operations platform for deploying intelligent agents — built on open agent runtimes like OpenClaw and Hermes — that do real work. Launch AI agents in minutes, automate business operations, and scale your AI workforce with your own isolated instances and no single-vendor lock-in.",
  domain: "sovereignml.com",
  // Full legal entity for use in legal pages (Terms, Privacy, Refund, SLA)
  // contact blocks, footers, and governing-law clauses. Marketing/nav copy
  // continues to use `name`.
  legalEntity: "SovereignML L.L.C.",
  jurisdiction: "North Carolina, USA",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supportEmail: "support@sovereignml.com",
  noreplyEmail: "noreply@sovereignml.com",
  github: "https://github.com/sovereignml",
  twitter: "https://twitter.com/sovereignml",
  linkedin: "https://linkedin.com/company/sovereignml",
  telegram: "#", // {{TODO: real Telegram invite URL}}
  demoUrl: "https://tidycal.com/sovereignml/demo",
  positioning: {
    headline: "Others give you tools. SovereignML gives you agents that work.",
    bullets: [
      "Deploy on open runtimes — OpenClaw & Hermes — no lock-in",
      "Monitor performance and health in real time",
      "Scale from one agent to an entire AI workforce",
    ],
  },
} as const

export type Branding = typeof BRANDING
