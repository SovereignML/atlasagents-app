import { AGENT_CATEGORIES, type AgentCategory } from "@/configs/agent-categories"
import { SKILL_MAP } from "@/configs/skill-map"

function findCategory(slug: string): AgentCategory {
  return (
    AGENT_CATEGORIES.find((c) => c.slug === slug) ??
    AGENT_CATEGORIES.find((c) => c.slug === "custom")!
  )
}

function skillsForSlug(slug: string): readonly string[] {
  return SKILL_MAP[slug] ?? SKILL_MAP.custom
}

const CATEGORY_DIRECTIVES: Record<string, string> = {
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
    "You are a general-purpose assistant. Adapt your approach to the user's domain and instructions. Ask clarifying questions when the task is ambiguous.",
}

/**
 * Generate AGENTS.md — the high-level persona and behavioral rules that
 * OpenClaw reads from /opt/openclaw/.openclaw/workspace/AGENTS.md on boot.
 */
export function generateAgentsMd(agentType: string): string {
  const cat = findCategory(agentType)
  const skills = skillsForSlug(agentType)
  const directive =
    CATEGORY_DIRECTIVES[agentType] ?? CATEGORY_DIRECTIVES.custom

  const lines: string[] = []

  lines.push(`# ${cat.name}`)
  lines.push("")
  lines.push(`> ${cat.description}`)
  lines.push("")

  lines.push("## Directive")
  lines.push("")
  lines.push(directive)
  lines.push("")

  lines.push("## Core Tasks")
  lines.push("")
  for (const ex of cat.examples) {
    lines.push(`- ${ex}`)
  }
  lines.push("")

  lines.push("## Available Skills")
  lines.push("")
  for (const skill of skills) {
    lines.push(`- \`${skill}\``)
  }
  lines.push("")

  lines.push("## Rules")
  lines.push("")
  lines.push("- Stay within your category scope. If a request falls outside your specialty, say so.")
  lines.push("- Never fabricate credentials, API keys, secrets, or internal URLs.")
  lines.push("- When uncertain, ask a clarifying question rather than guessing.")
  lines.push("- Prefer structured output (lists, tables, code blocks) over walls of text.")
  lines.push("")

  return lines.join("\n")
}

/**
 * Generate IDENTITY.md — the detailed identity card that OpenClaw reads from
 * /opt/openclaw/.openclaw/workspace/IDENTITY.md on boot.
 */
export function generateIdentityMd(agentType: string): string {
  const cat = findCategory(agentType)
  const skills = skillsForSlug(agentType)

  const lines: string[] = []

  lines.push("# Agent Identity Card")
  lines.push("")
  lines.push(`| Field | Value |`)
  lines.push(`|-------|-------|`)
  lines.push(`| **Name** | ${cat.name} |`)
  lines.push(`| **Category** | ${agentType} |`)
  lines.push(`| **Platform** | SovereignML |`)
  lines.push(`| **Skills** | ${skills.map((s) => `\`${s}\``).join(", ")} |`)
  lines.push("")

  lines.push("## Description")
  lines.push("")
  lines.push(cat.description)
  lines.push("")

  lines.push("## Specialization")
  lines.push("")
  lines.push(
    CATEGORY_DIRECTIVES[agentType] ?? CATEGORY_DIRECTIVES.custom,
  )
  lines.push("")

  lines.push("## Example Workflows")
  lines.push("")
  for (let i = 0; i < cat.examples.length; i++) {
    lines.push(`${i + 1}. ${cat.examples[i]}`)
  }
  lines.push("")

  return lines.join("\n")
}
