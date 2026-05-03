// Single source of truth for product identity. Edit here, propagates everywhere.

export const BRANDING = {
  name: "SovereignML",
  shortName: "SovereignML",
  tagline: "Launch. Automate. Scale.",
  subtagline: "Your AI workforce, deployed and managed.",
  description:
    "SovereignML is the AI operations platform for deploying intelligent agents that do real work. Launch AI agents in minutes, automate business operations, and scale your AI workforce with full ownership and control.",
  domain: "sovereignml.com",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supportEmail: "support@sovereignml.com",
  noreplyEmail: "noreply@sovereignml.com",
  github: "https://github.com/sovereignml",
  twitter: "https://twitter.com/sovereignml",
  linkedin: "https://linkedin.com/company/sovereignml",
  demoUrl: "https://tidycal.com/sovereignml/demo",
  positioning: {
    headline: "Others give you tools. SovereignML gives you agents that work.",
    bullets: [
      "Deploy AI agents that automate real tasks",
      "Monitor performance and health in real time",
      "Scale from one agent to an entire AI workforce",
    ],
  },
} as const

export type Branding = typeof BRANDING
