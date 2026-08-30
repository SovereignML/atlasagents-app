"use client"

import { useState } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { easing } from "@/lib/motion"
import { Reveal } from "@/components/marketing/motion/reveal"
import {
  Rocket,
  Terminal,
  CreditCard,
  Shield,
  Activity,
  Bot,
  Settings,
  ChevronDown,
  ArrowRight,
} from "lucide-react"
import { BRANDING } from "@/configs/branding"

const faqItems = [
  {
    question: `What is ${BRANDING.name}?`,
    answer:
      `${BRANDING.name} is an AI operations platform that lets you deploy, manage, and scale intelligent agents that automate real business tasks: from customer support to DevOps to content generation. You pick the agent type, configure it, and it runs.`,
  },
  {
    question: `Do I need AI/ML expertise to use ${BRANDING.name}?`,
    answer:
      "No. Our platform handles all the complexity. You choose what you want to automate, configure the basics, and we handle the deployment, optimization, and monitoring. For advanced custom builds, our team can design and deploy bespoke multi-agent systems.",
  },
  {
    question: "What agent types are available?",
    answer:
      "We support 8 agent categories: Automation (workflows, business ops), DevOps (infra monitoring, CI/CD), Support (customer tickets, live chat), Research (data analysis, web scraping), Content (blog posts, SEO copy), Sales (lead gen, outreach), Social Media Manager (content scheduling, growth), and Custom (bespoke builds).",
  },
  {
    question: "How does billing work?",
    answer:
      "Billing is monthly or yearly via Stripe. Plans include Free (10 credits), Lite ($9/mo), Builder ($19/mo), Operator ($69/mo), Scale ($179/mo), and Enterprise (from $499/mo). Credits cover AI usage, workflows, automations, and vector search; you can buy overage packs. Annual billing includes about two months free vs. monthly. Manage subscriptions from your dashboard.",
  },
  {
    question: "Can I deploy multiple agents?",
    answer:
      "Yes. How many agents you can run at once depends on your plan (live agent limits and credits). Higher tiers add more live agents, credits, and throughput. Each agent gets its own configuration and monitoring dashboard.",
  },
]

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className={`rounded-2xl border transition-colors duration-200 ${
        open ? "border-primary/40 bg-[var(--card-hover)]" : "border-[var(--border-color)] hover:border-primary"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between p-5 text-left cursor-pointer"
      >
        <span className="font-bold text-[var(--text-primary)] text-sm">
          {question}
        </span>
        <ChevronDown
          className={`w-5 h-5 text-primary shrink-0 ml-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: easing.outExpo }}
            className="overflow-hidden"
          >
            <p className="px-5 pb-5 text-[var(--text-secondary)] text-sm leading-relaxed">{answer}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const sections = [
  {
    icon: Rocket,
    title: "Quick Start",
    id: "quickstart",
    content: (
      <div className="space-y-4 text-[var(--text-secondary)] text-sm leading-relaxed">
        <p>Get your first AI agent running in under 5 minutes:</p>
        <ol className="space-y-3 list-none">
          {[
            `Create an account at ${BRANDING.domain}/register`,
            "From your dashboard, click Deploy Agent",
            "Name your project. A URL slug is auto-generated",
            "Select a billing interval (monthly or yearly)",
            "Pick a compute tier based on your workload",
            "Optionally add SSH keys or extra storage",
            "Review your config and click Deploy Agent",
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 flex items-center justify-center bg-primary/10 text-primary text-xs font-bold font-mono rounded">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="pt-2">
          In development mode, agents activate immediately without payment. In production, you are redirected to Stripe Checkout to complete billing before the agent provisions.
        </p>
      </div>
    ),
  },
  {
    icon: Bot,
    title: "Agent Types",
    id: "agents",
    content: (
      <div className="space-y-4 text-[var(--text-secondary)] text-sm leading-relaxed">
        <p>{BRANDING.name} supports 8 agent categories, each purpose-built for a specific business function:</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { name: "Automation Agent", desc: "Automate workflows, data entry, scheduled reports, and business ops.", plan: "Builder+" },
            { name: "DevOps Agent", desc: "Monitor infrastructure, manage CI/CD pipelines, and auto-resolve incidents.", plan: "Operator+" },
            { name: "Support Agent", desc: "Handle customer tickets, FAQ auto-responses, and live chat 24/7.", plan: "Builder+" },
            { name: "Research Agent", desc: "Scrape the web, analyze data, and generate actionable summaries.", plan: "Operator+" },
            { name: "Content Agent", desc: "Create blog posts, newsletters, and SEO-optimized copy.", plan: "Operator+" },
            { name: "Sales Agent", desc: "Generate leads, run outreach sequences, and enrich your CRM.", plan: "Operator+" },
            { name: "Social Media Manager", desc: "Schedule posts, optimize engagement, and execute growth strategies.", plan: "Operator+" },
            { name: "Custom Agent", desc: "Bespoke multi-agent systems built to your exact requirements.", plan: "Enterprise" },
          ].map((agent) => (
            <div key={agent.name} className="rounded-2xl border border-[var(--border-color)] shadow-[var(--shadow-sm)] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-[var(--text-primary)] text-sm">
                  {agent.name}
                </span>
                <span className="text-[0.65rem] border border-[var(--border-color)] px-2 py-0.5 text-primary font-mono rounded">
                  {agent.plan}
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{agent.desc}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    icon: Settings,
    title: "Deploy Wizard",
    id: "deploy",
    content: (
      <div className="space-y-4 text-[var(--text-secondary)] text-sm leading-relaxed">
        <p>The deploy wizard walks you through every configuration option:</p>
        <div className="space-y-3">
          {[
            { step: "1. Agent", desc: "Pick the runtime that powers your bot (OpenClaw or Hermes)." },
            { step: "2. Project", desc: "Enter your agent name and pick a use case. A URL-safe slug is auto-generated (e.g. My Support Agent → my-support-agent)." },
            { step: "3. Plan", desc: "Choose a plan. Every plan runs the same managed agent — only the included monthly credits differ." },
            { step: "4. Billing", desc: "Choose monthly or yearly billing (yearly saves ~17%, 2 months free), review your configuration, and deploy." },
          ].map((item) => (
            <div key={item.step} className="flex gap-4 border-l-2 border-[var(--border-color)] pl-4">
              <div>
                <p className="font-bold text-[var(--text-primary)] mb-1 font-mono text-[0.8rem]">
                  {item.step}
                </p>
                <p>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    icon: Activity,
    title: "Managing Agents",
    id: "managing",
    content: (
      <div className="space-y-4 text-[var(--text-secondary)] text-sm leading-relaxed">
        <p>All your deployed agents are accessible from the My Agents dashboard at <code className="text-primary bg-primary/10 px-1 rounded">/dashboard/instances</code>.</p>
        <div className="space-y-3">
          <div>
            <p className="font-bold text-[var(--text-primary)] mb-1">Status Badges</p>
            <p>Each agent shows a real-time status: <span className="text-emerald-400">running</span>, <span className="text-yellow-400">provisioning</span>, <span className="text-zinc-400">stopped</span>, <span className="text-red-400">failed</span>, or <span className="text-zinc-600">deleted</span>.</p>
          </div>
          <div>
            <p className="font-bold text-[var(--text-primary)] mb-1">Restart</p>
            <p>Running or failed agents can be restarted from the instances page. The agent briefly enters a provisioning state before coming back online.</p>
          </div>
          <div>
            <p className="font-bold text-[var(--text-primary)] mb-1">Stop</p>
            <p>Running agents can be stopped. Stopped agents retain their configuration and can be restarted at any time. Your subscription continues while stopped.</p>
          </div>
          <div>
            <p className="font-bold text-[var(--text-primary)] mb-1">Delete</p>
            <p>Deleting an agent permanently removes it and cancels the associated subscription. This action cannot be undone.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    icon: CreditCard,
    title: "Billing & Subscriptions",
    id: "billing",
    content: (
      <div className="space-y-4 text-[var(--text-secondary)] text-sm leading-relaxed">
        <p>Billing is handled via Stripe. Each deployed agent creates a Stripe subscription tied to your account.</p>
        <div className="space-y-3">
          <div>
            <p className="font-bold text-[var(--text-primary)] mb-1">Plans</p>
            <p>Plans are credit-based with included monthly credits and live agent limits per tier (see {BRANDING.domain}/pricing). Enterprise adds custom credit allocation, volume pricing, and SLAs.</p>
          </div>
          <div>
            <p className="font-bold text-[var(--text-primary)] mb-1">Yearly Billing</p>
            <p>Choosing yearly billing at deploy time saves about two months vs. paying monthly on Lite, Builder, Operator, and Scale. The billing interval cannot be changed after deployment.</p>
          </div>
          <div>
            <p className="font-bold text-[var(--text-primary)] mb-1">Billing Dashboard</p>
            <p>View your estimated monthly cost, active subscriptions, renewal dates, and per-agent billing details at <code className="text-primary bg-primary/10 px-1 rounded">/dashboard/billing</code>.</p>
          </div>
          <div>
            <p className="font-bold text-[var(--text-primary)] mb-1">Payment Issues</p>
            <p>If a payment fails, subscriptions enter a <span className="text-yellow-400">past_due</span> state. Update your payment method via Stripe to restore service. Contact support if issues persist.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    icon: Shield,
    title: "Security",
    id: "security",
    content: (
      <div className="space-y-4 text-[var(--text-secondary)] text-sm leading-relaxed">
        <div className="space-y-3">
          {[
            { title: "JWT Sessions", desc: "Stateless authentication via NextAuth v5. No server-side session storage. Role (user/admin) is embedded in the JWT token." },
            { title: "Password Hashing", desc: "All passwords are hashed with bcryptjs using 10 salt rounds. Passwords are never stored in plaintext." },
            { title: "Root Password Encryption", desc: "Instance root passwords are encrypted at rest using AES-256-GCM with a per-instance initialization vector. The encryption key is stored as an environment variable, never in the database." },
            { title: "Reset Token Security", desc: "Password reset tokens are stored as SHA-256 hashes. The plaintext token is only ever in the reset email link, never in our database." },
            { title: "Rate Limiting", desc: "Registration is limited to 5 attempts per IP per hour. Password reset is limited to 3 emails per address per hour." },
            { title: "Data Isolation", desc: "All database queries are scoped to your userId. Agents, subscriptions, and SSH keys from one account are never accessible to another." },
          ].map((item) => (
            <div key={item.title} className="flex gap-4 border-l-2 border-primary/30 pl-4">
              <div>
                <p className="font-bold text-[var(--text-primary)] mb-1 font-mono text-[0.8rem]">
                  {item.title}
                </p>
                <p>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    icon: Terminal,
    title: "API Reference",
    id: "api",
    content: (
      <div className="space-y-6 text-[var(--text-secondary)] text-sm leading-relaxed">
        {[
          {
            group: "Auth",
            endpoints: [
              { method: "POST", path: "/api/auth/register", desc: "Create a new account" },
              { method: "POST", path: "/api/auth/forgot-password", desc: "Request a password reset email" },
              { method: "POST", path: "/api/auth/reset-password", desc: "Reset password with token" },
              { method: "GET", path: "/api/auth/account", desc: "Get authenticated user profile" },
              { method: "PATCH", path: "/api/auth/account", desc: "Update name, password, or social handles" },
            ],
          },
          {
            group: "Agents",
            endpoints: [
              { method: "POST", path: "/api/deploy", desc: "Deploy a new AI agent" },
              { method: "GET", path: "/api/instances", desc: "List all your deployed agents" },
              { method: "POST", path: "/api/instances/[id]/restart", desc: "Restart an agent" },
              { method: "POST", path: "/api/instances/[id]/delete", desc: "Delete an agent" },
            ],
          },
          {
            group: "Billing",
            endpoints: [
              { method: "GET", path: "/api/billing", desc: "Get billing overview and cost summary" },
              { method: "GET", path: "/api/subscriptions", desc: "List all subscriptions" },
            ],
          },
          {
            group: "Planner",
            endpoints: [
              { method: "POST", path: "/api/planner", desc: "Get agent recommendation for a use case (public)" },
            ],
          },
        ].map((group) => (
          <div key={group.group}>
            <h4 className="text-primary text-xs mb-3 font-mono">
              {group.group}
            </h4>
            <div className="space-y-2">
              {group.endpoints.map((ep) => (
                <div key={ep.path} className="flex items-start gap-3 rounded-xl border border-[var(--border-color)] p-3">
                  <span
                    className={`shrink-0 text-[0.65rem] font-bold px-2 py-0.5 rounded font-mono ${
                      ep.method === "GET"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                        : ep.method === "POST"
                        ? "bg-blue-500/10 text-blue-400 border border-blue-500/30"
                        : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30"
                    }`}
                  >
                    {ep.method}
                  </span>
                  <div>
                    <code className="text-[var(--text-primary)] text-xs font-mono">
                      {ep.path}
                    </code>
                    <p className="text-[var(--text-secondary)] text-xs mt-0.5">{ep.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    ),
  },
]

export default function DocsPage() {
  return (
    <div className="max-w-[1200px] mx-auto px-8 py-16">
      {/* Header */}
      <Reveal className="border-l-4 border-primary pl-8 mb-16">
        <div className="text-primary text-xs mb-3 opacity-80">
          Docs
        </div>
        <h1 className="text-[clamp(2.5rem,5vw,4rem)] font-bold text-[var(--text-primary)] mb-4">
          Documentation
        </h1>
        <p className="text-[var(--text-secondary)] text-lg max-w-2xl">
          Everything you need to deploy and manage AI agents on {BRANDING.name}.
        </p>
      </Reveal>

      <div className="flex flex-col lg:flex-row gap-12">
        {/* Sidebar nav */}
        <aside className="lg:w-56 shrink-0">
          <nav className="lg:sticky lg:top-[100px] space-y-1">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover)] transition-colors border-l-2 border-transparent hover:border-primary rounded-r-lg"
              >
                <s.icon className="w-4 h-4 shrink-0" />
                {s.title}
              </a>
            ))}
            <a
              href="#faq"
              className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover)] transition-colors border-l-2 border-transparent hover:border-primary rounded-r-lg"
            >
              <ChevronDown className="w-4 h-4 shrink-0" />
              FAQ
            </a>
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 space-y-16 min-w-0">
          {sections.map((s) => (
            <Reveal as="section" key={s.id} id={s.id} className="scroll-mt-[120px]">
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[var(--border-color)]">
                <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10 text-primary shrink-0">
                  <s.icon className="w-5 h-5" />
                </span>
                <h2 className="text-xl font-bold text-[var(--text-primary)]">
                  {s.title}
                </h2>
              </div>
              {s.content}
            </Reveal>
          ))}

          {/* FAQ */}
          <Reveal as="section" id="faq" className="scroll-mt-[120px]">
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[var(--border-color)]">
              <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10 text-primary shrink-0">
                <ChevronDown className="w-5 h-5" />
              </span>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">
                FAQ
              </h2>
            </div>
            <div className="space-y-3">
              {faqItems.map((item) => (
                <FAQItem key={item.question} question={item.question} answer={item.answer} />
              ))}
            </div>
          </Reveal>

          {/* CTA */}
          <Reveal className="rounded-2xl border border-primary/30 bg-primary/10 p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div>
              <p className="text-primary text-xs mb-1">
                Ready?
              </p>
              <p className="text-[var(--text-primary)] font-bold text-lg">
                Deploy your first AI agent now
              </p>
            </div>
            <Link
              href="/login?deploy=true"
              className="btn-gradient !py-2.5 !px-5 !text-sm flex items-center gap-2 whitespace-nowrap"
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </Link>
          </Reveal>
        </div>
      </div>
    </div>
  )
}
