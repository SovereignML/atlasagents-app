// Subscription tier metadata. Drives pricing UI, landing sections, and DB seed.
// Stripe price IDs are set via env when wiring Stripe checkout.

export type PlanTier = "free" | "builder" | "operator" | "scale" | "enterprise"

export type PlanCTA = "start-free" | "get-started" | "contact-sales"

export type PlanConfig = {
  slug: string
  tier: PlanTier
  name: string
  /** Subtitle under tier name */
  description: string
  features: string[]
  /** Shown for Free tier (e.g. no always-on agents) */
  restrictions?: readonly string[]
  stripePriceIdMonthly: string
  stripePriceIdYearly: string
  isActive: boolean
  sortOrder: number
  /** Credits granted each billing period (seed + product logic) */
  creditsPerPeriod: number
  /** Monthly list price (0 for Free) — this is the all-in customer-facing price */
  displayPriceMonthly: number
  /** Annual list price (0 for Free; Enterprise may omit use of this) */
  displayPriceYearly: number
  highlight?: boolean
  cta: PlanCTA
  /** Enterprise custom price line */
  enterprisePriceLabel?: string
  /** Server config slug that this plan provisions (null = custom / contact sales) */
  serverConfigSlug: string | null
}

export const PLANS: readonly PlanConfig[] = [
  {
    slug: "free",
    tier: "free",
    name: "Free",
    description: "Try and build",
    features: [
      "100 credits included",
      "Limited workflows",
      "Basic agent deployment",
      "Community support",
    ],
    restrictions: ["No always-on agents"],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_FREE_MONTHLY ?? "",
    stripePriceIdYearly: process.env.STRIPE_PRICE_FREE_YEARLY ?? "",
    isActive: true,
    sortOrder: 0,
    creditsPerPeriod: 100,
    displayPriceMonthly: 0,
    displayPriceYearly: 0,
    cta: "start-free",
    serverConfigSlug: "shared-1g",
  },
  {
    slug: "builder",
    tier: "builder",
    name: "Builder",
    description: "For solo builders",
    features: [
      "3,000 credits included",
      "Deploy AI agents",
      "Workflow automation",
      "Basic integrations",
      "Email support",
      "1 live agent included",
    ],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_BUILDER_MONTHLY ?? "",
    stripePriceIdYearly: process.env.STRIPE_PRICE_BUILDER_YEARLY ?? "",
    isActive: true,
    sortOrder: 10,
    creditsPerPeriod: 3_000,
    displayPriceMonthly: 79,
    displayPriceYearly: 790,
    cta: "get-started",
    serverConfigSlug: "shared-2g",
  },
  {
    slug: "operator",
    tier: "operator",
    name: "Operator",
    description: "For growing operations",
    features: [
      "12,000 credits included",
      "Multi-agent workflows",
      "Advanced integrations",
      "Priority processing",
      "Standard support",
      "3 live agents included",
    ],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_OPERATOR_MONTHLY ?? "",
    stripePriceIdYearly: process.env.STRIPE_PRICE_OPERATOR_YEARLY ?? "",
    isActive: true,
    sortOrder: 20,
    creditsPerPeriod: 12_000,
    displayPriceMonthly: 199,
    displayPriceYearly: 1_990,
    highlight: true,
    cta: "get-started",
    serverConfigSlug: "shared-4g",
  },
  {
    slug: "scale",
    tier: "scale",
    name: "Scale",
    description: "For agencies and teams",
    features: [
      "35,000 credits included",
      "High-throughput workflows",
      "Team collaboration",
      "Advanced monitoring",
      "Priority support",
      "10 live agents included",
    ],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_SCALE_MONTHLY ?? "",
    stripePriceIdYearly: process.env.STRIPE_PRICE_SCALE_YEARLY ?? "",
    isActive: true,
    sortOrder: 30,
    creditsPerPeriod: 35_000,
    displayPriceMonthly: 399,
    displayPriceYearly: 3_990,
    cta: "get-started",
    serverConfigSlug: "shared-8g",
  },
  {
    slug: "enterprise",
    tier: "enterprise",
    name: "Enterprise",
    description: "For high-scale organizations",
    features: [
      "Custom credit allocation",
      "Dedicated infrastructure",
      "SLA guarantees",
      "Custom integrations",
      "Dedicated support",
      "Scalable agent deployments",
    ],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY ?? "",
    stripePriceIdYearly: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY ?? "",
    isActive: true,
    sortOrder: 40,
    creditsPerPeriod: 0,
    displayPriceMonthly: 999,
    displayPriceYearly: 9_990,
    enterprisePriceLabel: "$999/month",
    cta: "contact-sales",
    serverConfigSlug: "shared-16g",
  },
] as const

export const PRICING_POSITIONING = {
  headline: "AI Workforce Infrastructure",
  subheadline:
    "Build, deploy, and scale autonomous AI operations — without managing complexity.",
} as const

export const OVERAGE_PACKS = [
  { credits: 2_000, priceUsd: 25 },
  { credits: 10_000, priceUsd: 99 },
  { credits: 25_000, priceUsd: 199 },
] as const

export const ADD_ONS = [
  { name: "Extra live agent", price: "$29/mo" },
  { name: "Premium integrations", price: "$49/mo" },
  { name: "Priority support", price: "$99/mo" },
  { name: "White-label", price: "$199/mo" },
  { name: "Custom workflow builds", price: "Starting at $500" },
] as const

export const CREDIT_TOOLTIP =
  "Credits are consumed based on AI usage and workflows."

export function findPlanBySlug(slug: string): PlanConfig | undefined {
  return PLANS.find((p) => p.slug === slug)
}

/** Plans available for self-serve deployment (excludes enterprise / contact-sales) */
export const DEPLOYABLE_PLANS = PLANS.filter(
  (p) => p.cta !== "contact-sales" && p.serverConfigSlug !== null,
)

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`
}
