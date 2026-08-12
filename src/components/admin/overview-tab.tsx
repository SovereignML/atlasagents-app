import type { AdminOverview } from "@/lib/admin-metrics"
import { StatCard } from "@/components/admin/stat-card"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageSection } from "@/components/layout/page-container"
import {
  ActivationFunnel,
  AgentStatusDonut,
  AgentsCreatedChart,
  DailySignupsChart,
  MonthlySignupsChart,
  RuntimeSplitChart,
} from "@/components/admin/dashboard-charts"

/**
 * The business-and-fleet overview: growth first, then what that growth is
 * running on, then what it earns.
 *
 * Every section degrades on its own — `overview` is a Partial, and a section
 * whose aggregate failed renders a small notice instead of vanishing, so a
 * missing panel can't be mistaken for a genuine zero.
 */
export function OverviewTab({
  overview,
  failures,
}: {
  overview: Partial<AdminOverview>
  failures: string[]
}) {
  const { signups, funnel, agents, servers, revenue, queue } = overview

  return (
    <div className="space-y-8">
      {failures.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load: {failures.join(", ")}. Those panels are hidden rather than
          shown as zero — check the server logs for <code>[admin-metrics]</code>.
        </div>
      )}

      {/* ── Headline KPIs ── */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Signups today"
          value={signups?.today ?? "—"}
          tone="accent"
          hint={
            signups
              ? `${signups.last7} in the last 7 days${formatDelta(signups.wowDelta, "vs prior 7")}`
              : "unavailable"
          }
          href="/admin/users"
        />
        <StatCard
          label="Total users"
          value={signups?.total.toLocaleString() ?? "—"}
          hint={
            signups
              ? `${signups.last30} in the last 30 days${formatDelta(signups.momDelta, "vs prior 30")}`
              : "unavailable"
          }
          href="/admin/users"
        />
        <StatCard
          label="Active agents"
          value={agents?.running ?? "—"}
          tone="positive"
          hint={
            agents
              ? `of ${agents.total} total · ${agents.activeLast24h} active in 24h`
              : "unavailable"
          }
          href="/admin/instances"
        />
        <StatCard
          label="Active servers"
          value={servers?.activeServers ?? "—"}
          hint={
            servers
              ? `${servers.totalVcpu} vCPU · ${servers.totalRamGb} GB RAM provisioned`
              : "unavailable"
          }
          href="/admin/instances"
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="MRR"
          value={revenue ? `$${revenue.mrrUsd.toFixed(0)}` : "—"}
          tone="accent"
          hint={revenue ? `$${revenue.arpaUsd.toFixed(2)} avg per paying account` : "unavailable"}
          href="/admin/revenue"
        />
        <StatCard
          label="Paying subscriptions"
          value={revenue ? revenue.activeSubs + revenue.trialingSubs : "—"}
          hint={revenue ? `${revenue.trialingSubs} trialing · ${revenue.canceledSubs} canceled` : "unavailable"}
          href="/admin/subscriptions"
        />
        <StatCard
          label="Past due"
          value={revenue?.pastDueSubs ?? "—"}
          tone={revenue && revenue.pastDueSubs > 0 ? "danger" : "positive"}
          hint="payment actively failing"
          href="/admin/subscriptions"
        />
        <StatCard
          label="Open tickets"
          value={queue?.openTickets ?? "—"}
          tone={queue && queue.urgentTickets > 0 ? "danger" : queue && queue.openTickets > 0 ? "warning" : "positive"}
          hint={
            queue
              ? `${queue.urgentTickets} urgent · ${queue.pendingDeletions} deletion requests`
              : "unavailable"
          }
        />
      </div>

      {/* ── Growth ── */}
      {signups && (
        <PageSection title="Growth">
          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard
              title="Daily signups"
              description="New accounts per day, last 30 days"
            >
              <DailySignupsChart data={signups.daily} />
            </ChartCard>
            <ChartCard
              title="Monthly signups"
              description="New accounts per month, last 12 months"
            >
              <MonthlySignupsChart data={signups.monthly} />
            </ChartCard>
          </div>
        </PageSection>
      )}

      {/* ── Activation ── */}
      <div className="grid gap-5 lg:grid-cols-2">
        {funnel && (
          <ChartCard
            title="Activation funnel"
            description="Where new accounts stall on the way to paying"
          >
            <ActivationFunnel stages={funnel} />
          </ChartCard>
        )}
        {agents && (
          <ChartCard title="Agents by status" description="Every non-deleted agent">
            <AgentStatusDonut data={agents.byStatus} />
          </ChartCard>
        )}
      </div>

      {/* ── Fleet growth & composition ── */}
      {agents && (
        <PageSection title="Fleet">
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ChartCard
                title="Agents created"
                description="New agents per day, last 30 days"
              >
                <AgentsCreatedChart data={agents.createdDaily} />
              </ChartCard>
            </div>
            <ChartCard title="By runtime" description="Engine split across the fleet">
              <RuntimeSplitChart data={agents.byRuntime} />
            </ChartCard>
          </div>
        </PageSection>
      )}

      {/* ── Infrastructure spread ── */}
      {servers && (servers.byRegion.length > 0 || servers.byPlan.length > 0) && (
        <PageSection title="Infrastructure">
          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard title="Servers by region" description="Live VMs holding a public IP">
              <BreakdownList rows={servers.byRegion} />
            </ChartCard>
            <ChartCard title="Servers by plan" description="Live VMs holding a public IP">
              <BreakdownList rows={servers.byPlan} />
            </ChartCard>
          </div>
        </PageSection>
      )}
    </div>
  )
}

/** "+12% vs prior 7" / "—" when there's no baseline to compare against. */
function formatDelta(pct: number | null | undefined, suffix: string): string {
  if (pct == null) return ""
  const sign = pct > 0 ? "+" : ""
  return ` · ${sign}${pct.toFixed(0)}% ${suffix}`
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/**
 * Ranked count list. A plain table beats a bar chart here: these are long-tail
 * nominal categories (regions, plan labels) where the exact number matters more
 * than the shape, and the row count is unbounded.
 */
function BreakdownList({ rows }: { rows: { key: string; count: number }[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No live servers.</p>
  }
  const total = rows.reduce((s, r) => s + r.count, 0)

  return (
    <ul className="space-y-2">
      {rows.slice(0, 8).map((r) => (
        <li key={r.key} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="truncate text-muted-foreground">{r.key}</span>
          <span className="shrink-0 font-mono tabular-nums">
            <span className="font-medium text-foreground">{r.count}</span>
            <span className="ml-2 text-muted-foreground">
              {total > 0 ? Math.round((r.count / total) * 100) : 0}%
            </span>
          </span>
        </li>
      ))}
      {rows.length > 8 && (
        <li className="pt-1 text-xs text-muted-foreground">
          +{rows.length - 8} more
        </li>
      )}
    </ul>
  )
}
