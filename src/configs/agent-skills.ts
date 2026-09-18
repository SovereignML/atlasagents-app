/**
 * Agent Skills catalog — curated "job playbooks" an agent can be given. Unlike
 * tools (capabilities/infrastructure; see agent-tools.ts), a skill is prompt
 * knowledge: it injects battle-tested guidance into the agent's identity files
 * (AGENTS.md / IDENTITY.md / SOUL.md) so an agency doesn't have to write prompts.
 *
 * Stored on the instance as a flat array of `id`s (`instances.skills`). A skill
 * can declare the tools it needs (`requiredTools`); enabling the skill
 * auto-enables those tools (see the skills API route). Skills are
 * runtime-agnostic — they are pure prompt content, so there is no per-runtime
 * support matrix here.
 */
export type AgentSkill = {
  /** Stable id stored in `instances.skills`, e.g. "lead_qualification". */
  id: string
  /** Human-facing name shown in the Skills tab and rendered into identity files. */
  name: string
  /** lucide-react icon name (same convention as agent-tools / agent-categories). */
  icon: string
  /** One-line summary for the Skills tab card. */
  description: string
  /** Agent category this skill is most associated with (AGENT_CATEGORIES slug). */
  category: string
  /** The playbook text injected into the agent's identity files. */
  promptGuidance: string
  /** Catalog tool ids this skill needs; enabling the skill auto-enables them. */
  requiredTools?: string[]
  /** Listed but not wired yet — UI shows a disabled toggle; API rejects enabling. */
  comingSoon?: boolean
}

export const AGENT_SKILLS: readonly AgentSkill[] = [
  {
    id: "kb_answer",
    name: "Answer from Knowledge Base",
    icon: "BookOpen",
    description:
      "Answer using your uploaded documents and cite the source file. Say so when the answer isn't covered.",
    category: "support",
    requiredTools: ["knowledge_base"],
    promptGuidance:
      "When a question can be answered from the reference material in your `knowledge/` directory, ground your answer in it and cite the source file name. If the material does not cover the question, say so plainly instead of guessing.",
  },
  {
    id: "ticket_triage",
    name: "Ticket triage & escalation",
    icon: "Inbox",
    description:
      "Classify incoming requests by urgency and intent, resolve what you can, and escalate the rest cleanly.",
    category: "support",
    promptGuidance:
      "Triage each incoming request: identify intent and urgency, acknowledge the user's situation before proposing a fix, resolve straightforward issues directly, and escalate to a human when confidence is low — summarizing the issue, what you tried, and why you're escalating.",
  },
  {
    id: "lead_qualification",
    name: "Lead qualification (BANT)",
    icon: "Filter",
    description:
      "Qualify leads against Budget, Authority, Need, and Timeline before routing them onward.",
    category: "sales",
    promptGuidance:
      "Qualify leads using BANT — surface Budget, Authority, Need, and Timeline through natural conversation rather than an interrogation. Score the lead, note missing dimensions, and recommend the next step (route to sales, nurture, or disqualify) with a one-line rationale.",
  },
  {
    id: "outreach_sequences",
    name: "Outreach & follow-up",
    icon: "Send",
    description:
      "Draft concise, outcome-driven outreach and timed follow-ups, each ending in a clear next step.",
    category: "sales",
    promptGuidance:
      "Write outreach that opens with the recipient's outcome, stays concise, and closes with a single clear call to action. For follow-ups, reference the prior touch, add new value each time, and stop after a reasonable cadence.",
  },
  {
    id: "appointment_booking",
    name: "Appointment / demo booking",
    icon: "Calendar",
    description:
      "Guide users to book a meeting, confirm details, and handle reschedules.",
    category: "sales",
    comingSoon: true,
    promptGuidance:
      "Drive the conversation toward booking a meeting: offer concrete time options, confirm timezone and contact details, and handle reschedule/cancel requests gracefully.",
  },
  {
    id: "research_summarize",
    name: "Research & summarize",
    icon: "Search",
    description:
      "Search the web, compare sources, and summarize findings first — then offer to expand.",
    category: "research",
    requiredTools: ["web_search"],
    promptGuidance:
      "Research by gathering from multiple sources, distinguishing facts from inferences, and citing where claims come from. Lead with a tight summary, then offer to expand. Flag when sources conflict or evidence is thin.",
  },
  {
    id: "content_seo",
    name: "Content drafting + SEO",
    icon: "PenLine",
    description:
      "Draft on-brand content with a clear structure and sensible SEO, proposing an outline before long-form.",
    // Re-homed from the retired "content" category onto the Social Media
    // Agent, which absorbed content duties when Content Agent was removed.
    // Left uncategorized it would have matched no template and stopped being
    // offered as a default skill to anyone.
    category: "social",
    requiredTools: ["web_search"],
    promptGuidance:
      "For content, match the brand voice and propose a structure/outline before drafting long-form. Apply sensible on-page SEO (clear title, headings, natural keyword use) without keyword stuffing.",
  },
  {
    id: "social_engagement",
    name: "Social scheduling & replies",
    icon: "MessageCircle",
    description:
      "Write platform-native captions and replies, adapting tone per platform.",
    category: "social",
    promptGuidance:
      "Produce platform-native social copy — adapt tone and length per platform (LinkedIn vs X vs Instagram). Keep replies prompt, on-brand, and de-escalating; propose a content calendar when asked.",
  },
  {
    id: "report_recap",
    name: "Report / recap generation",
    icon: "FileText",
    description:
      "Turn activity into a clear, structured recap with highlights, metrics, and next actions.",
    category: "automation",
    promptGuidance:
      "When asked to report or recap, lead with the headline outcome, then structured detail (highlights, metrics, blockers, next actions). Prefer tables and bullet lists over prose. Be precise with numbers.",
  },
]

/** Look up a skill by its catalog id. */
export function getSkill(id: string): AgentSkill | undefined {
  return AGENT_SKILLS.find((s) => s.id === id)
}

/** Resolve enabled skill ids to catalog skills, dropping unknown/comingSoon ids. */
export function enabledSkills(ids: string[]): AgentSkill[] {
  return ids
    .map((id) => getSkill(id))
    .filter((s): s is AgentSkill => !!s && !s.comingSoon)
}

/** Union (deduped) of the tool ids required by the given enabled skills. */
export function requiredToolsForSkills(ids: string[]): string[] {
  const out = new Set<string>()
  for (const id of ids) {
    const skill = getSkill(id)
    if (!skill || skill.comingSoon) continue
    for (const t of skill.requiredTools ?? []) out.add(t)
  }
  return [...out]
}

/**
 * Default skill ids for an agent category (AGENT_CATEGORIES slug). Used to seed
 * `instances.skills` at create time and as the fallback when an instance has no
 * explicit selection. Falls back to the "custom" set for unknown categories.
 */
export function defaultSkillsForCategory(slug: string): string[] {
  return AGENT_SKILLS.filter((s) => !s.comingSoon && s.category === slug).map(
    (s) => s.id,
  )
}
