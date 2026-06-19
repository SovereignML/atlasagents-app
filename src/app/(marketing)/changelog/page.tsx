import { Reveal, RevealGroup, RevealItem } from "@/components/marketing/motion/reveal"

type Entry = {
  date: string
  version: string
  tag: "feature" | "fix" | "breaking" | "docs"
  title: string
  body: string[]
}

const ENTRIES: Entry[] = [
  {
    date: "2026-04-15",
    version: "v0.9.0",
    tag: "feature",
    title: "Instance detail dashboard + Monitoring",
    body: [
      "New tabbed detail page at /dashboard/instances/[id]: Overview, Controls, AI Config, Interfaces, Skills, Monitoring, Usage.",
      "Global monitoring at /dashboard/monitoring with per-agent uptime table.",
      "Every instance now has a public gateway URL shown at the top of its detail page.",
    ],
  },
  {
    date: "2026-04-12",
    version: "v0.8.0",
    tag: "feature",
    title: "Deploy wizard: streamlined agent-type-driven flow",
    body: [
      "Merged Project and Purpose into a single step with use-case selection, target user, and tone.",
      "Removed Capability step. Core actions are now auto-derived from the selected agent type.",
      "Location selection moved under Interface. Telegram, Discord, REST API, Shared Cluster, and Serverless greyed out as coming soon.",
      "Custom domain setup moved to post-deploy Controls tab.",
    ],
  },
  {
    date: "2026-04-08",
    version: "v0.7.2",
    tag: "fix",
    title: "Dark palette rollback",
    body: [
      "Restored the neon-yellow + pure-black dark palette. The softer warm palette experiment is gone for now.",
    ],
  },
  {
    date: "2026-04-02",
    version: "v0.7.0",
    tag: "docs",
    title: "Legal pages live",
    body: [
      "Privacy Policy, Terms of Service, and SLA pages are published.",
      "Footer links now point to real routes, not placeholders.",
    ],
  },
  {
    date: "2026-03-25",
    version: "v0.6.0",
    tag: "feature",
    title: "User menu + Admin login",
    body: [
      "Dashboard topbar gained a full user menu with Profile, My Agents, Billing, Settings, Sign Out.",
      "Admin panel login flow hardened.",
    ],
  },
]

const TAG_STYLES: Record<Entry["tag"], string> = {
  feature: "border-primary/40 text-primary bg-primary/10",
  fix: "border-amber-500/40 text-amber-400 bg-amber-500/5",
  breaking: "border-red-500/40 text-red-400 bg-red-500/5",
  docs: "border-[var(--border-color)] text-[var(--text-secondary)] bg-[var(--card-bg)]",
}

const DOT_STYLES: Record<Entry["tag"], string> = {
  feature: "bg-primary",
  fix: "bg-amber-400",
  breaking: "bg-red-400",
  docs: "bg-[var(--text-secondary)]",
}

export default function ChangelogPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 space-y-12">
      <Reveal>
        <p className="text-xs font-mono text-primary mb-2">
          / changelog
        </p>
        <h1 className="text-4xl font-bold text-[var(--text-primary)]">
          Changelog
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-3">
          Everything we ship, in chronological order. Subscribe to the RSS feed at{" "}
          <code className="font-mono text-primary">/changelog.rss</code> (coming soon).
        </p>
      </Reveal>

      {/* Timeline: a continuous rail down the left, one card per release. */}
      <RevealGroup className="relative space-y-5">
        <div
          aria-hidden
          className="absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-primary/40 via-[var(--border-color)] to-transparent"
        />
        {ENTRIES.map((e) => (
          <RevealItem key={e.version} className="relative pl-10">
            <span
              aria-hidden
              className={`absolute left-0 top-[6px] w-[15px] h-[15px] rounded-full ring-4 ring-[var(--background)] ${DOT_STYLES[e.tag]}`}
            />
            <article className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-6 transition-all duration-300 hover:shadow-[var(--shadow-hover)] hover:border-primary/30">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-mono text-[var(--text-secondary)]">{e.date}</span>
                <span className="text-xs font-mono text-[var(--text-primary)]">{e.version}</span>
                <span className={`text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border ${TAG_STYLES[e.tag]}`}>
                  {e.tag}
                </span>
              </div>
              <h2 className="text-xl font-semibold mt-2 text-[var(--text-primary)]">{e.title}</h2>
              <ul className="mt-3 space-y-1.5 text-sm text-[var(--text-secondary)] list-disc list-inside marker:text-primary/50">
                {e.body.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </article>
          </RevealItem>
        ))}
      </RevealGroup>
    </div>
  )
}
