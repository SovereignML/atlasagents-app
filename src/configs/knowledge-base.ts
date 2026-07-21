// Single source of truth for the in-app support knowledge base.
//
// The marketing /docs page is the real, rich knowledge base. This module is a
// lightweight, searchable INDEX of that content: section metadata that mirrors
// the docs anchors, the operational FAQ shown on the support page, and the
// support category cards. The support page consumes this for real search, real
// article counts, and deep-links to /docs#<section>.
//
// IMPORTANT: KB_SECTIONS ids MUST match the section ids used in
// src/app/(marketing)/docs/page.tsx so `/docs#${id}` resolves to the right
// anchor.

import {
  Rocket,
  Bot,
  Settings,
  Activity,
  CreditCard,
  Shield,
  Terminal,
  Coins,
  Server,
  type LucideIcon,
} from "lucide-react"

/** A docs section, mirrored as a searchable knowledge-base entry. */
export interface KbSection {
  /** Anchor id on /docs — `/docs#${id}` must resolve. */
  id: string
  title: string
  summary: string
  keywords: string[]
  icon: LucideIcon
}

/** An operational FAQ entry shown on the support page. */
export interface KbFaq {
  question: string
  answer: string
  /** Most relevant section id; used for the "Read more in docs" deep-link. */
  anchor?: string
}

/** A support category card grouping one or more docs sections. */
export interface KbCategory {
  title: string
  /** Section ids in this category; the first is the card's primary deep-link. */
  sectionIds: string[]
  icon: LucideIcon
  /** Tailwind classes for the card's icon tile. */
  tile: string
}

export const KB_SECTIONS: KbSection[] = [
  {
    id: "quickstart",
    title: "Quick Start",
    summary:
      "Get your first AI agent running in under five minutes — create an account, open the deploy wizard, pick a compute tier, and launch.",
    keywords: ["start", "first agent", "deploy", "getting started", "launch", "setup"],
    icon: Rocket,
  },
  {
    id: "agents",
    title: "Agent Types",
    summary:
      "The eight agent categories — Automation, DevOps, Support, Research, Content, Sales, Social Media Manager, and Custom — and which plans they need.",
    keywords: ["agent types", "automation", "devops", "support agent", "research", "content", "sales", "social", "custom"],
    icon: Bot,
  },
  {
    id: "deploy",
    title: "Deploy Wizard",
    summary:
      "Walk through every config option: project name, billing interval, server/compute tier, advanced options (root password, SSH key, extra storage), and review.",
    keywords: ["deploy wizard", "server", "compute tier", "ssh", "storage", "byos", "bring your own server", "provision"],
    icon: Settings,
  },
  {
    id: "managing",
    title: "Managing Agents",
    summary:
      "Manage deployed agents from the dashboard — status badges, restart, stop, and delete, plus what happens to billing in each state.",
    keywords: ["manage", "restart", "stop", "delete", "status", "downtime", "instances", "uptime", "monitoring"],
    icon: Activity,
  },
  {
    id: "billing",
    title: "Billing & Subscriptions",
    summary:
      "How credits, plans, and Stripe subscriptions work, including yearly billing savings, the billing dashboard, and resolving failed payments.",
    keywords: ["billing", "credits", "subscription", "stripe", "plan", "pricing", "payment", "invoice", "past due"],
    icon: CreditCard,
  },
  {
    id: "security",
    title: "Security",
    summary:
      "Platform security: JWT sessions, password hashing, AES-256-GCM root-password encryption, hashed reset tokens, rate limiting, and per-user data isolation.",
    keywords: ["security", "encryption", "password", "jwt", "session", "rate limit", "data isolation", "privacy"],
    icon: Shield,
  },
  {
    id: "api",
    title: "API Reference",
    summary:
      "REST endpoints for auth, agents, billing, and the planner — methods, paths, and what each call does.",
    keywords: ["api", "rest", "endpoint", "integration", "developer", "token", "webhook"],
    icon: Terminal,
  },
]

export const KB_FAQS: KbFaq[] = [
  {
    question: "How do I deploy my first agent?",
    answer:
      "Head to the Deploy page, pick your runtime and a plan, and we provision and launch your agent automatically. You can watch progress live from the instance page.",
    anchor: "quickstart",
  },
  {
    question: "How does billing & credits work?",
    answer:
      "You buy credits that cover real LLM usage at cost plus a small margin. Managed agents are billed daily; BYOS is a flat monthly fee per connected server.",
    anchor: "billing",
  },
  {
    question: "Can I connect a server I already own?",
    answer:
      "Yes. Use Bring Your Own Server: paste our fleet SSH key into your box and we act as its management panel. Your data never leaves your hardware.",
    anchor: "deploy",
  },
  {
    question: "What happens if my agent goes down?",
    answer:
      "We monitor every instance and alert you. Managed updates and restarts keep things healthy, and you can trigger a restart yourself from the instance page.",
    anchor: "managing",
  },
]

export const KB_CATEGORIES: KbCategory[] = [
  {
    title: "Deploying agents",
    sectionIds: ["quickstart", "agents"],
    icon: Rocket,
    tile: "bg-primary/15 text-primary",
  },
  {
    title: "Billing & credits",
    sectionIds: ["billing"],
    icon: Coins,
    tile: "bg-sky-400/15 text-sky-400",
  },
  {
    title: "Servers & BYOS",
    sectionIds: ["deploy", "managing"],
    icon: Server,
    tile: "bg-violet-500/15 text-violet-500",
  },
]

/** Number of KB entries (sections + FAQs) that belong to a category. */
export function categoryArticleCount(category: KbCategory): number {
  const ids = new Set(category.sectionIds)
  const sections = KB_SECTIONS.filter((s) => ids.has(s.id)).length
  const faqs = KB_FAQS.filter((f) => f.anchor && ids.has(f.anchor)).length
  return sections + faqs
}

export interface KbSearchResults {
  sections: KbSection[]
  faqs: KbFaq[]
}

/**
 * Case-insensitive search over section titles/summaries/keywords and FAQ
 * questions/answers. Returns empty results for a blank query.
 */
export function searchKnowledgeBase(query: string): KbSearchResults {
  const q = query.trim().toLowerCase()
  if (!q) return { sections: [], faqs: [] }

  const sections = KB_SECTIONS.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.summary.toLowerCase().includes(q) ||
      s.keywords.some((k) => k.toLowerCase().includes(q)),
  )
  const faqs = KB_FAQS.filter(
    (f) =>
      f.question.toLowerCase().includes(q) ||
      f.answer.toLowerCase().includes(q),
  )
  return { sections, faqs }
}
