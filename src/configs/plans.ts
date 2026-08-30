// Subscription tier metadata. Drives pricing UI, landing sections, and DB seed.
// Stripe price IDs are set via env when wiring Stripe checkout.

export type PlanTier =
  | "free"
  | "lite"
  | "builder"
  | "operator"
  | "scale"
  | "enterprise"
  | "byos"

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
  /** Team seats incl. the owner (who always occupies one); `Infinity` = unlimited. */
  seats: number
  /** Monthly list price (0 for Free) — this is the all-in customer-facing price (promo/live) */
  displayPriceMonthly: number
  /** Annual list price (0 for Free; Enterprise may omit use of this) — promo/live */
  displayPriceYearly: number
  /** Full (after-launch) monthly price; shown struck-through when > displayPriceMonthly */
  fullPriceMonthly: number
  /** Full (after-launch) yearly price; shown struck-through when > displayPriceYearly */
  fullPriceYearly: number
  highlight?: boolean
  cta: PlanCTA
  /** Enterprise custom price line (promo/live) */
  enterprisePriceLabel?: string
  /** Enterprise full (after-launch) price line; shown struck-through above the promo label */
  enterpriseFullPriceLabel?: string
  /** Server config slug that this plan provisions (null = custom / contact sales) */
  serverConfigSlug: string | null
}

/**
 * How long a Free-tier (demo) agent stays live after it provisions before the
 * reaper tears it down. `instances.expiresAt` carries the deadline; a non-null
 * value is the single "this is a demo agent" signal used by the reaper + the
 * dashboard countdown. See src/lib/demo-reaper.ts.
 */
export const FREE_DEMO_TTL_MS = 30 * 60 * 1000 // 30 minutes

export const PLANS: readonly PlanConfig[] = [
  {
    slug: "free",
    tier: "free",
    name: "Free",
    description: "Try and build",
    features: [
      "10 credits included",
      "Limited workflows",
      "Basic agent deployment",
      "1 team seat",
      "Community support",
    ],
    restrictions: ["No always-on agents"],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_FREE_MONTHLY ?? "",
    stripePriceIdYearly: process.env.STRIPE_PRICE_FREE_YEARLY ?? "",
    isActive: true,
    sortOrder: 0,
    creditsPerPeriod: 10,
    seats: 1,
    displayPriceMonthly: 0,
    displayPriceYearly: 0,
    fullPriceMonthly: 0,
    fullPriceYearly: 0,
    cta: "start-free",
    // Free is a time-boxed demo (auto-reaped after FREE_DEMO_TTL_MS), so it
    // runs on the same machine as Builder for a representative experience.
    serverConfigSlug: "shared-4g",
  },
  {
    slug: "lite",
    tier: "lite",
    name: "Lite",
    description: "For trying it for real",
    features: [
      "500 credits included",
      "Deploy AI agents",
      "Workflow automation",
      "Email support",
      "1 live agent included",
      "2 team seats",
    ],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_LITE_MONTHLY ?? "",
    stripePriceIdYearly: process.env.STRIPE_PRICE_LITE_YEARLY ?? "",
    isActive: true,
    sortOrder: 5,
    creditsPerPeriod: 500,
    seats: 2,
    displayPriceMonthly: 9,
    displayPriceYearly: 90,
    fullPriceMonthly: 9,
    fullPriceYearly: 90,
    cta: "get-started",
    // Every self-serve plan provisions the SAME baseline box (Linode g6-standard-2,
    // 2 vCPU / 4GB, Frankfurt). Only creditsPerPeriod differs between tiers.
    serverConfigSlug: "shared-4g",
  },
  {
    slug: "builder",
    tier: "builder",
    name: "Builder",
    description: "For solo builders",
    features: [
      "1,000 credits included",
      "Deploy AI agents",
      "Workflow automation",
      "Basic integrations",
      "Email support",
      "1 live agent included",
      "5 team seats",
    ],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_BUILDER_MONTHLY ?? "",
    stripePriceIdYearly: process.env.STRIPE_PRICE_BUILDER_YEARLY ?? "",
    isActive: true,
    sortOrder: 10,
    creditsPerPeriod: 1_000,
    seats: 5,
    displayPriceMonthly: 19,
    displayPriceYearly: 190,
    fullPriceMonthly: 29,
    fullPriceYearly: 290,
    cta: "get-started",
    serverConfigSlug: "shared-4g",
  },
  {
    slug: "operator",
    tier: "operator",
    name: "Operator",
    description: "For growing operations",
    features: [
      "2,000 credits included",
      "Multi-agent workflows",
      "Advanced integrations",
      "Priority processing",
      "Standard support",
      "3 live agents included",
      "10 team seats",
    ],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_OPERATOR_MONTHLY ?? "",
    stripePriceIdYearly: process.env.STRIPE_PRICE_OPERATOR_YEARLY ?? "",
    isActive: true,
    sortOrder: 20,
    creditsPerPeriod: 2_000,
    seats: 10,
    displayPriceMonthly: 69,
    displayPriceYearly: 690,
    fullPriceMonthly: 99,
    fullPriceYearly: 990,
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
      "5,000 credits included",
      "High-throughput workflows",
      "Team collaboration",
      "Advanced monitoring",
      "Priority support",
      "10 live agents included",
      "25 team seats",
    ],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_SCALE_MONTHLY ?? "",
    stripePriceIdYearly: process.env.STRIPE_PRICE_SCALE_YEARLY ?? "",
    isActive: true,
    sortOrder: 30,
    creditsPerPeriod: 5_000,
    seats: 25,
    displayPriceMonthly: 179,
    displayPriceYearly: 1_790,
    fullPriceMonthly: 249,
    fullPriceYearly: 2_490,
    cta: "get-started",
    serverConfigSlug: "shared-4g",
  },
  {
    slug: "enterprise",
    tier: "enterprise",
    name: "Enterprise",
    description: "For high-scale organizations",
    features: [
      "Custom credit allocation",
      "Volume credit pricing",
      "SLA guarantees",
      "Custom integrations",
      "Dedicated support",
      "Scalable agent deployments",
      "Unlimited team seats",
    ],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY ?? "",
    stripePriceIdYearly: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY ?? "",
    isActive: true,
    sortOrder: 40,
    creditsPerPeriod: 0,
    seats: Number.POSITIVE_INFINITY,
    displayPriceMonthly: 499,
    displayPriceYearly: 4_990,
    fullPriceMonthly: 999,
    fullPriceYearly: 9_990,
    enterprisePriceLabel: "From $499/mo",
    enterpriseFullPriceLabel: "From $999/mo",
    cta: "contact-sales",
    serverConfigSlug: "shared-4g",
  },
  {
    // Bring Your Own Server — Atlas Agents acts purely as the management panel
    // for a server the customer already owns. Flat recurring management fee;
    // no compute billing (we don't own the box). LLM usage is either metered
    // against the credit wallet (pay-as-you-go) or paid directly via the
    // customer's own API key. serverConfigSlug points at the `byos-managed`
    // sentinel row so the Instance FKs are satisfied without a managed-VPS plan.
    slug: "byos",
    tier: "byos",
    name: "Bring Your Own Server",
    description: "Management only",
    features: [
      "Connect your own server",
      "Full management panel",
      "Deploy & monitor your agent",
      "100 AI credits included (managed mode)",
      "Or bring your own API key",
      "Logs, restart, and config controls",
      "5 team seats",
    ],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_BYOS_MONTHLY ?? "",
    stripePriceIdYearly: process.env.STRIPE_PRICE_BYOS_YEARLY ?? "",
    isActive: true,
    sortOrder: 50,
    creditsPerPeriod: 0,
    seats: 5,
    displayPriceMonthly: 2.5,
    displayPriceYearly: 30,
    fullPriceMonthly: 2.5,
    fullPriceYearly: 30,
    cta: "get-started",
    serverConfigSlug: "byos-managed",
  },
] as const

export const PRICING_POSITIONING = {
  headline: "AI Workforce Infrastructure",
  subheadline:
    "Build, deploy, and scale autonomous AI operations without managing complexity.",
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

/**
 * Team seats for a plan tier (incl. the owner, who always occupies one seat).
 * `Infinity` = unlimited (Enterprise). Defaults to Free (1) for unknown tiers.
 */
export function seatsForTier(tier: PlanTier): number {
  return PLANS.find((p) => p.tier === tier)?.seats ?? 1
}

/**
 * Plans available for self-serve deployment in the standard managed-VPS deploy
 * wizard (excludes enterprise / contact-sales and the BYOS plan, which has its
 * own dedicated section + flow at /dashboard/byos).
 */
export const DEPLOYABLE_PLANS = PLANS.filter(
  (p) =>
    p.cta !== "contact-sales" &&
    p.serverConfigSlug !== null &&
    p.tier !== "byos",
)

/** The Bring Your Own Server management-panel plan. */
export const BYOS_PLAN = PLANS.find((p) => p.tier === "byos")!

/** One-time credits granted to a BYOS user on signup when they use managed AI (no own key). */
export const BYOS_SIGNUP_CREDITS = 100

export function formatUsd(amount: number): string {
  const hasCents = !Number.isInteger(amount)
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}
