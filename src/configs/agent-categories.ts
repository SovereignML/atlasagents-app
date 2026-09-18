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
    // The engine as it ships, with no role layered on top. Deliberately first:
    // it is the "I just want the agent" choice, and every other entry in this
    // list is a specialization of it. Its label is resolved at render time to
    // "Default Hermes Agent" or "Default OpenClaw Agent" from the runtime the
    // user picked a step earlier — see `categoryDisplayName`.
    slug: "default",
    name: "Default Agent",
    role: "General Assistant",
    icon: "Bot",
    description:
      "The runtime's stock agent, exactly as it ships. General-purpose, with no role persona or playbooks applied.",
    examples: [
      "General-purpose chat & tasks",
      "Run whatever you instruct it to",
      "A blank slate to build on",
    ],
  },
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
    name: "Social Media Agent",
    // The job title stays "Social Media Manager" — that is what the agent
    // self-identifies as in its persona files. Only the product-facing label
    // changed, to match the naming of every other entry ("… Agent").
    role: "Social Media Manager",
    icon: "Share2",
    description:
      "Your autonomous social media team: generate content, schedule posts, and grow your audience.",
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
  default:
    "You are a general-purpose assistant with no specialization. Follow the user's instructions directly and do not assume a domain or a house style they have not asked for. When a task is ambiguous, ask rather than guess.",
  automation:
    "You specialize in automating workflows, processing structured data, and orchestrating multi-step business operations without human intervention. Prefer deterministic execution over exploratory reasoning.",
  devops:
    "You specialize in infrastructure monitoring, CI/CD pipelines, incident triage, and operational reliability. Communicate in terse, actionable language. When diagnosing issues, start with the most recent error and work backwards.",
  support:
    "You specialize in customer-facing support: triaging tickets, drafting empathetic replies, and escalating to humans when confidence is low. Always acknowledge the user's frustration before proposing a fix.",
  research:
    "You specialize in information retrieval, source comparison, and synthesis. Cite sources when available. Distinguish facts from inferences. Summarize first, then offer to expand.",
  // LEGACY — "Content Agent" was retired from AGENT_CATEGORIES, so this is no
  // longer selectable. Kept because agents deployed while it existed still
  // carry `use_case: "content"`, and their persona is regenerated from this map
  // on every reprovision/agent-type save. Dropping it would silently demote
  // those agents to the generic directive. Remove once none remain:
  //   SELECT COUNT(*) FROM "Instance"
  //   WHERE status != 'deleted' AND "agentConfig"->>'use_case' = 'content';
  content:
    "You specialize in content creation, editing, and SEO optimization across blogs, social media, and newsletters. Match the brand voice. Propose structure before drafting long-form content.",
  sales:
    "You specialize in lead qualification, outreach sequencing, and CRM data enrichment. Keep messages concise and outcome-driven. Always end with a clear call to action.",
  social:
    "You specialize in social media management: generating platform-native captions, scheduling posts, analyzing engagement metrics, and proposing content calendars. Adapt tone per platform (LinkedIn vs Twitter vs Instagram).",
  custom:
    "You are a general-purpose specialist. Adapt your approach to the user's domain and instructions. Ask clarifying questions when the task is ambiguous.",
}

/** The stock-engine template, whose label depends on the chosen runtime. */
export const DEFAULT_CATEGORY_SLUG = "default"

/**
 * Runtime id → product label. A deliberate copy of the two runtime display
 * names rather than an import: this module is pulled into client components
 * (both deploy wizards, the agent-type picker), and `@/lib/runtimes` drags the
 * provisioner's module graph with it. Source of truth is
 * `src/lib/runtimes/{openclaw,hermes}.ts` — keep in sync if a third engine
 * lands.
 */
const RUNTIME_LABELS: Record<string, string> = {
  openclaw: "OpenClaw",
  hermes: "Hermes",
}

/**
 * The label to show for a category.
 *
 * Identical to `category.name` for every specialization. The `default`
 * template is the exception: it has no identity of its own, so it is named
 * after the engine it runs — "Default Hermes Agent" / "Default OpenClaw
 * Agent". Falls back to the plain "Default Agent" when no runtime is known
 * yet (or is one we don't have a label for), so the UI never renders
 * "Default undefined Agent".
 */
export function categoryDisplayName(slug: string, runtime?: string | null): string {
  const category = findCategory(slug)
  if (category.slug !== DEFAULT_CATEGORY_SLUG) return category.name
  const label = runtime ? RUNTIME_LABELS[runtime] : undefined
  return label ? `Default ${label} Agent` : category.name
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
