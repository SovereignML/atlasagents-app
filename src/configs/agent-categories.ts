export type AgentCategory = {
  slug: string
  /** Product-facing label used in the deploy wizard (e.g. "Support Agent"). */
  name: string
  /**
   * The human job title the agent self-identifies as (e.g. "Support
   * Specialist"). This is what makes a deployment read as an *AI Employee*
   * with a role rather than as the underlying framework — it drives the
   * role-first persona in `generateSoul` / `generateIdentityMd`.
   */
  role: string
  icon: string
  description: string
  examples: string[]
}

export const AGENT_CATEGORIES: readonly AgentCategory[] = [
  {
    slug: "automation",
    name: "Automation Agent",
    role: "Automation Specialist",
    icon: "Zap",
    description: "Automate workflows, business operations, and repetitive tasks.",
    examples: [
      "Invoice processing & approvals",
      "Data entry & migration",
      "Scheduled report generation",
    ],
  },
  {
    slug: "devops",
    name: "DevOps Agent",
    role: "DevOps Engineer",
    icon: "Terminal",
    description: "Monitor infrastructure, manage CI/CD, and resolve incidents.",
    examples: [
      "Log analysis & alerting",
      "Deployment automation",
      "Infrastructure health checks",
    ],
  },
  {
    slug: "support",
    name: "Support Agent",
    role: "Support Specialist",
    icon: "MessageSquare",
    description: "Handle customer inquiries, tickets, and live chat 24/7.",
    examples: [
      "Ticket triage & routing",
      "FAQ auto-response",
      "Escalation management",
    ],
  },
  {
    slug: "research",
    name: "Research Agent",
    role: "Research Analyst",
    icon: "Search",
    description: "Analyze data, scrape the web, and generate actionable summaries.",
    examples: [
      "Market research & analysis",
      "Competitive intelligence",
      "Document summarization",
    ],
  },
  {
    slug: "content",
    name: "Content Agent",
    role: "Content Strategist",
    icon: "PenTool",
    description: "Create, schedule, and optimize content across channels.",
    examples: [
      "Blog & social media posts",
      "Email newsletter drafts",
      "SEO content optimization",
    ],
  },
  {
    slug: "sales",
    name: "Sales Agent",
    role: "Sales Development Rep",
    icon: "TrendingUp",
    description: "Generate leads, automate outreach, and manage your CRM.",
    examples: [
      "Lead scoring & qualification",
      "Automated email sequences",
      "CRM data enrichment",
    ],
  },
  {
    slug: "social",
    name: "Social Media Manager",
    role: "Social Media Manager",
    icon: "Share2",
    description: "Your autonomous social media team: generate content, schedule posts, and grow your audience.",
    examples: [
      "Content generation & scheduling",
      "Engagement optimization",
      "Growth strategy execution",
    ],
  },
  {
    slug: "custom",
    name: "Custom Agent",
    role: "Specialist",
    icon: "Settings",
    description: "Build a bespoke AI agent tailored to your exact requirements.",
    examples: [
      "Domain-specific workflows",
      "Multi-agent orchestration",
      "Enterprise integrations",
    ],
  },
] as const

/**
 * Per-role behavioral directive — *how* the agent works in its specialty.
 * Single source of truth, consumed by both `generateSoul` (the canonical
 * persona) and `generateIdentityMd` (the supporting identity card).
 */
export const CATEGORY_DIRECTIVES: Record<string, string> = {
  automation:
    "You specialize in automating workflows, processing structured data, and orchestrating multi-step business operations without human intervention. Prefer deterministic execution over exploratory reasoning.",
  devops:
    "You specialize in infrastructure monitoring, CI/CD pipelines, incident triage, and operational reliability. Communicate in terse, actionable language. When diagnosing issues, start with the most recent error and work backwards.",
  support:
    "You specialize in customer-facing support: triaging tickets, drafting empathetic replies, and escalating to humans when confidence is low. Always acknowledge the user's frustration before proposing a fix.",
  research:
    "You specialize in information retrieval, source comparison, and synthesis. Cite sources when available. Distinguish facts from inferences. Summarize first, then offer to expand.",
  content:
    "You specialize in content creation, editing, and SEO optimization across blogs, social media, and newsletters. Match the brand voice. Propose structure before drafting long-form content.",
  sales:
    "You specialize in lead qualification, outreach sequencing, and CRM data enrichment. Keep messages concise and outcome-driven. Always end with a clear call to action.",
  social:
    "You specialize in social media management: generating platform-native captions, scheduling posts, analyzing engagement metrics, and proposing content calendars. Adapt tone per platform (LinkedIn vs Twitter vs Instagram).",
  custom:
    "You are a general-purpose specialist. Adapt your approach to the user's domain and instructions. Ask clarifying questions when the task is ambiguous.",
}

/** Resolve a category by slug, falling back to "custom". */
export function findCategory(slug: string): AgentCategory {
  return (
    AGENT_CATEGORIES.find((c) => c.slug === slug) ??
    AGENT_CATEGORIES.find((c) => c.slug === "custom")!
  )
}

/** The human job title the agent self-identifies as (e.g. "Support Specialist"). */
export function roleTitleForSlug(slug: string): string {
  return findCategory(slug).role
}

/** The behavioral directive for a role, falling back to the custom directive. */
export function directiveForSlug(slug: string): string {
  return CATEGORY_DIRECTIVES[slug] ?? CATEGORY_DIRECTIVES.custom
}
