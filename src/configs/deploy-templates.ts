export type DeployTemplate = {
  id: string
  name: string
  icon: string
  tagline: string
  useCase: string
  tone: "formal" | "friendly" | "technical" | "casual"
  interfaceKind: "web" | "telegram" | "discord" | "slack" | "api"
  budgetTier: "low" | "mid" | "high"
  deploymentTarget: "vps" | "shared" | "serverless"
  knowledgeSource: "none" | "url" | "file"
  coreActionHints: string[]
}

export const DEPLOY_TEMPLATES: readonly DeployTemplate[] = [
  {
    id: "support",
    name: "Support Bot",
    icon: "💬",
    tagline: "24/7 triage for inbound tickets and FAQs.",
    useCase: "support",
    tone: "friendly",
    interfaceKind: "web",
    budgetTier: "mid",
    deploymentTarget: "vps",
    knowledgeSource: "url",
    coreActionHints: ["Ticket triage & routing", "FAQ auto-response"],
  },
  {
    id: "sales-sdr",
    name: "Sales SDR",
    icon: "📈",
    tagline: "Qualify inbound leads and book meetings.",
    useCase: "sales",
    tone: "friendly",
    interfaceKind: "web",
    budgetTier: "mid",
    deploymentTarget: "vps",
    knowledgeSource: "none",
    coreActionHints: ["Lead scoring & qualification", "Automated email sequences"],
  },
  {
    id: "devops-watchdog",
    name: "DevOps Watchdog",
    icon: "🔧",
    tagline: "Watch logs, summarize incidents, suggest fixes.",
    useCase: "devops",
    tone: "technical",
    interfaceKind: "web",
    budgetTier: "high",
    deploymentTarget: "vps",
    knowledgeSource: "none",
    coreActionHints: ["Log analysis & alerting", "Deployment automation"],
  },
  {
    id: "content-engine",
    name: "Content Engine",
    icon: "✍️",
    tagline: "Draft posts, schedule, optimize SEO.",
    useCase: "content",
    tone: "casual",
    interfaceKind: "web",
    budgetTier: "mid",
    deploymentTarget: "vps",
    knowledgeSource: "url",
    coreActionHints: ["Blog & social media posts", "SEO content optimization"],
  },
  {
    id: "research-analyst",
    name: "Research Analyst",
    icon: "🔎",
    tagline: "Crawl, summarize, and report on any topic.",
    useCase: "research",
    tone: "formal",
    interfaceKind: "web",
    budgetTier: "high",
    deploymentTarget: "vps",
    knowledgeSource: "url",
    coreActionHints: ["Market research & analysis", "Document summarization"],
  },
  {
    id: "telegram-assistant",
    name: "Telegram Assistant",
    icon: "✈️",
    tagline: "Personal Telegram bot with your tone.",
    useCase: "custom",
    tone: "casual",
    interfaceKind: "web",
    budgetTier: "low",
    deploymentTarget: "vps",
    knowledgeSource: "none",
    coreActionHints: [],
  },
] as const

export type BudgetTier = "low" | "mid" | "high"

export const TIER_CREDIT_COST: Record<BudgetTier, { perRequest: number; creditsPerDollar: number; note: string }> = {
  low: { perRequest: 1, creditsPerDollar: 1000, note: "small OpenRouter models" },
  mid: { perRequest: 4, creditsPerDollar: 250, note: "GPT-4o-mini / GLM-4" },
  high: { perRequest: 12, creditsPerDollar: 80, note: "Claude Opus / GPT-4.1" },
}

export function estimateMonthlyCost(tier: BudgetTier, requestsPerDay = 500): { credits: number; usd: number } {
  const credits = TIER_CREDIT_COST[tier].perRequest * requestsPerDay * 30
  const usd = credits / TIER_CREDIT_COST[tier].creditsPerDollar
  return { credits, usd }
}
