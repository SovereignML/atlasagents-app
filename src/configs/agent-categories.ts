export type AgentCategory = {
  slug: string
  name: string
  icon: string
  description: string
  examples: string[]
}

export const AGENT_CATEGORIES: readonly AgentCategory[] = [
  {
    slug: "automation",
    name: "Automation Agent",
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
    icon: "Share2",
    description: "Your autonomous social media team — generate content, schedule posts, and grow your audience.",
    examples: [
      "Content generation & scheduling",
      "Engagement optimization",
      "Growth strategy execution",
    ],
  },
  {
    slug: "custom",
    name: "Custom Agent",
    icon: "Settings",
    description: "Build a bespoke AI agent tailored to your exact requirements.",
    examples: [
      "Domain-specific workflows",
      "Multi-agent orchestration",
      "Enterprise integrations",
    ],
  },
] as const
