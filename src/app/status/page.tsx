import Link from "next/link"
import { MotionConfig } from "framer-motion"
import { Reveal, RevealGroup, RevealItem } from "@/components/marketing/motion/reveal"
import { BRANDING } from "@/configs/branding"
import { db, providers, providerHealthLogs, desc, eq, sql } from "@/db"
import {
  deploymentsState,
  overallState,
  HEADLINES,
  type CheckState,
  type ProviderProbe,
} from "@/lib/platform-status"

// Checked when requested, never prerendered at build time.
export const dynamic = "force-dynamic"

type Check = { name: string; state: CheckState; detail: string }
type Snapshot = { checks: Check[]; checkedAt: Date }

// A public, unauthenticated page: reuse one snapshot for this long so traffic
// can't turn into database load.
const SNAPSHOT_TTL_MS = 30_000
const QUERY_TIMEOUT_MS = 3_000

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function checkDatabase(): Promise<Check> {
  const name = "Database"
  try {
    await withTimeout(db.execute(sql`select 1`), QUERY_TIMEOUT_MS)
    return { name, state: "operational", detail: "Answered a query." }
  } catch {
    return {
      name,
      state: "outage",
      detail: "Did not answer a test query. Sign-in, billing and the dashboard depend on it.",
    }
  }
}

/** The newest probe for each enabled provider (null if it has never been probed). */
async function latestProviderProbes(): Promise<ProviderProbe[]> {
  const enabled = await db.query.providers.findMany({
    where: eq(providers.enabled, true),
    columns: { id: true },
  })
  return Promise.all(
    enabled.map(async (p) => {
      const [probe] = await db
        .select({ status: providerHealthLogs.status, checkedAt: providerHealthLogs.checkedAt })
        .from(providerHealthLogs)
        .where(eq(providerHealthLogs.providerId, p.id))
        .orderBy(desc(providerHealthLogs.checkedAt))
        .limit(1)
      return probe ?? null
    }),
  )
}

const DEPLOYMENT_DETAIL: Record<CheckState, string> = {
  operational: "A server provider passed its latest health check.",
  degraded: "Server providers are returning errors, so new deployments may fail or be slow.",
  outage: "No server provider passed its latest health check, so new deployments will fail.",
  unknown: "No server provider health check in the last hour.",
}

async function checkDeployments(now: Date): Promise<Check> {
  const name = "New agent deployments"
  try {
    const state = deploymentsState(await withTimeout(latestProviderProbes(), QUERY_TIMEOUT_MS), now)
    return { name, state, detail: DEPLOYMENT_DETAIL[state] }
  } catch {
    return { name, state: "unknown", detail: "Provider health could not be read." }
  }
}

/** Never rejects: each check turns its own failure into a state. */
async function takeSnapshot(): Promise<Snapshot> {
  const checkedAt = new Date()
  const checks: Check[] = [
    { name: "Dashboard and API", state: "operational", detail: "Served this page." },
    ...(await Promise.all([checkDatabase(), checkDeployments(checkedAt)])),
  ]
  return { checks, checkedAt }
}

let cached: { at: number; snapshot: Promise<Snapshot> } | null = null

function getSnapshot(): Promise<Snapshot> {
  const now = Date.now()
  if (!cached || now - cached.at >= SNAPSHOT_TTL_MS) {
    cached = { at: now, snapshot: takeSnapshot() }
  }
  return cached.snapshot
}

const STATE_STYLE: Record<CheckState, { dot: string; text: string; label: string }> = {
  operational: { dot: "bg-primary", text: "text-primary", label: "Operational" },
  degraded: { dot: "bg-amber-400", text: "text-amber-400", label: "Degraded" },
  outage: { dot: "bg-red-400", text: "text-red-400", label: "Down" },
  unknown: {
    dot: "bg-[var(--text-secondary)]",
    text: "text-[var(--text-secondary)]",
    label: "Unknown",
  },
}

const BANNER_STYLE: Record<CheckState, string> = {
  operational: "border-primary bg-primary/10",
  degraded: "border-amber-400/40 bg-amber-400/10",
  outage: "border-red-500/40 bg-red-500/10",
  unknown: "border-[var(--border-color)] bg-[var(--card-bg)]",
}

export default async function StatusPage() {
  const { checks, checkedAt } = await getSnapshot()
  const overall = overallState(checks.map((c) => c.state))
  const beacon = STATE_STYLE[overall].dot

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[var(--bg-color)] text-[var(--text-primary)]">
        <div className="max-w-5xl mx-auto px-6 py-16 space-y-10">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <Link href="/" className="text-xl font-bold">
              {BRANDING.name}
            </Link>
            <div className="text-xs font-mono text-[var(--text-secondary)]">
              Checked: {checkedAt.toISOString().slice(0, 19).replace("T", " ")} UTC
            </div>
          </div>

          <Reveal className={`rounded-2xl border p-6 flex items-center gap-4 ${BANNER_STYLE[overall]}`}>
            {/* Live beacon, colored by the worst current check. */}
            <span className="relative flex h-3.5 w-3.5 shrink-0">
              <span
                className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-[beacon-pulse_2s_ease-out_infinite] ${beacon}`}
              />
              <span className={`relative inline-flex h-3.5 w-3.5 rounded-full ${beacon}`} />
            </span>
            <div>
              <h1 className="text-3xl font-bold text-[var(--text-primary)]">{HEADLINES[overall]}</h1>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Checked live when this page is requested; results are reused for up to 30 seconds.
              </p>
            </div>
          </Reveal>

          <section>
            <h2 className="text-xs font-mono text-[var(--text-secondary)] mb-3">Services</h2>
            <RevealGroup className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
              {checks.map((c, i) => {
                const style = STATE_STYLE[c.state]
                return (
                  <RevealItem
                    key={c.name}
                    className={`flex items-start justify-between gap-6 px-4 py-3 transition-colors hover:bg-[var(--card-hover)] ${
                      i !== checks.length - 1 ? "border-b border-[var(--border-color)]" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-1.5 inline-flex h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                      <div>
                        <p className="text-sm">{c.name}</p>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5">{c.detail}</p>
                      </div>
                    </div>
                    <span className={`text-[10px] font-mono uppercase tracking-wide ${style.text}`}>
                      {style.label}
                    </span>
                  </RevealItem>
                )
              })}
            </RevealGroup>
          </section>

          <p className="text-xs text-[var(--text-secondary)]">
            Each agent&apos;s own health is on its page in the dashboard. Seeing a problem that
            isn&apos;t shown here? Email{" "}
            <a href={`mailto:${BRANDING.supportEmail}`} className="underline">
              {BRANDING.supportEmail}
            </a>
            .
          </p>
        </div>
      </div>
    </MotionConfig>
  )
}
