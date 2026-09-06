import Link from "next/link"
import { redirect } from "next/navigation"
import {
  Plus,
  Rocket,
  Activity,
  Bot,
  Coins,
  Clock,
  Gauge,
  Server,
  ShieldCheck,
  ChevronRight,
  BarChart3,
} from "lucide-react"

import { auth } from "@/auth"
import {
  db,
  eq,
  and,
  gte,
  sql,
  ne,
  instances,
  subscriptions,
  instanceLogs,
  wallets,
} from "@/db"
import { whereUserInstancesVisible } from "@/lib/instance-queries"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { PageContainer } from "@/components/layout/page-container"
import { StatCard } from "@/components/dashboard/stat-card"
import { ActivityChart, SpendChart, LatencyChart } from "@/components/dashboard/overview-charts"
import { getEffectiveUserId } from "@/lib/effective-user"
import { usdToCredits, creditsToUsd } from "@/lib/credit-pricing"
import { getRunsPerDay, getDailySpend, getLatencySeries } from "@/lib/dashboard-metrics"

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
  const firstName = (session.user.name || "").trim().split(/\s+/)[0] || "there"

  // Server component: this runs once per request, so reading the clock is not
  // the impure render react-hooks/purity guards against (which targets client
  // components re-rendered by the React Compiler).
  // eslint-disable-next-line react-hooks/purity
  const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [
    allInstances,
    allSubscriptions,
    walletRow,
    incidents24Rows,
    runsPerDay,
    dailySpend,
    latencySeries,
  ] = await Promise.all([
    db.query.instances.findMany({
      where: whereUserInstancesVisible(effectiveUserId),
      with: { region: true, serverConfig: true },
      orderBy: (t, { desc }) => desc(t.createdAt),
    }),
    db.query.subscriptions.findMany({
      where: eq(subscriptions.userId, effectiveUserId),
      with: { plan: true },
    }),
    db.query.wallets.findFirst({
      where: eq(wallets.userId, effectiveUserId),
      columns: { balance: true },
    }),
    db
      .select({ count: sql<number>`count(*)` })
      .from(instanceLogs)
      .innerJoin(instances, eq(instanceLogs.instanceId, instances.id))
      .where(
        and(
          eq(instances.userId, effectiveUserId),
          ne(instances.status, "deleted"),
          eq(instanceLogs.level, "error"),
          gte(instanceLogs.createdAt, since24)
        )
      ),
    getRunsPerDay(effectiveUserId, 14),
    getDailySpend(effectiveUserId, 7),
    getLatencySeries(effectiveUserId, 24),
  ])

  const visibleInstances = allInstances.filter((i) => i.status !== "deleted")
  const activeInstances = visibleInstances.filter((i) => i.status === "running").length
  const activeSubs = allSubscriptions.filter((s) => s.status === "active").length
  const credits = Math.round(walletRow?.balance ?? 0)
  const dailyBurnUsd = visibleInstances
    .filter((i) => i.status === "running")
    .reduce((sum, i) => sum + i.serverConfig.priceMonthly / 30, 0)
  const dailyBurnCredits = usdToCredits(dailyBurnUsd)
  const runwayDays =
    dailyBurnCredits > 0 ? Math.max(0, Math.floor(credits / dailyBurnCredits)) : null
  const incidents24 = Number(incidents24Rows[0]?.count ?? 0)
  const totalRuns14d = runsPerDay.reduce((sum, d) => sum + d.runs, 0)
  const latestLatencyMs =
    latencySeries.length > 0 ? latencySeries[latencySeries.length - 1].ms : null

  // Auto-pause threshold: the credit floor at which running agents are paused
  // to protect the wallet. Derived from one day of burn (real values).
  const autoPauseBelow = dailyBurnCredits > 0 ? dailyBurnCredits : 0

  // Lime progress bar: how much of a 5-day "comfortable runway" remains.
  const runwayPct =
    runwayDays === null ? 100 : Math.max(4, Math.min(100, Math.round((runwayDays / 5) * 100)))

  // Six tinted hero tiles — purely decorative surface for the platform pillars.
  const heroTiles = [
    { icon: Bot, cls: "text-primary" },
    { icon: Activity, cls: "text-emerald-400" },
    { icon: Gauge, cls: "text-cyan-400" },
    { icon: Coins, cls: "text-amber-400" },
    { icon: Server, cls: "text-violet-400" },
    { icon: ShieldCheck, cls: "text-rose-400" },
  ]

  return (
    <PageContainer>
      {/* Hero card */}
      <div className="console-hero relative overflow-hidden rounded-[18px] border border-border p-6 sm:p-8">
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">
              Launch · Automate · Scale
            </p>
            <h1 className="mt-2 text-[28px] font-semibold leading-tight text-foreground">
              Welcome back, {firstName}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Deploy, monitor, and scale your AI agents from a single control plane.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button
                variant="gradient"
                size="pill"
                render={
                  <Link href="/dashboard/deploy">
                    <Plus data-icon="inline-start" />
                    Deploy New Agent
                  </Link>
                }
              />
              <Button
                variant="outline"
                size="pill"
                render={
                  <Link href="/dashboard/monitoring">
                    <Activity data-icon="inline-start" />
                    View monitoring
                  </Link>
                }
              />
            </div>
          </div>

          <div className="grid w-fit shrink-0 grid-cols-3 grid-rows-2 gap-3">
            {heroTiles.map((tile, i) => {
              const Icon = tile.icon
              return (
                <div
                  key={i}
                  className="flex size-11 items-center justify-center rounded-[11px] border border-border bg-secondary"
                >
                  <Icon className={`size-5 ${tile.cls}`} />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Agents"
          value={visibleInstances.length}
          hint={`${incidents24} incident${incidents24 === 1 ? "" : "s"} in 24h`}
          icon={Bot}
          tone="primary"
          glow
        />
        <StatCard
          label="Running"
          value={activeInstances}
          hint={`of ${visibleInstances.length} total`}
          icon={Activity}
          tone="emerald"
          glow
        />
        <StatCard
          label="Credits"
          value={credits.toLocaleString()}
          hint={
            dailyBurnCredits > 0
              ? `${dailyBurnCredits.toLocaleString()} cr/day burn`
              : "no running agents"
          }
          icon={Coins}
          tone="amber"
          glow
        />
        <StatCard
          label="Runway"
          value={
            runwayDays === null
              ? "-"
              : runwayDays > 999
                ? "999+"
                : `${runwayDays} day${runwayDays === 1 ? "" : "s"}`
          }
          hint={
            runwayDays === null
              ? `${activeSubs} active plan${activeSubs === 1 ? "" : "s"}`
              : `at ~$${creditsToUsd(dailyBurnCredits).toFixed(2)}/day`
          }
          icon={Clock}
          tone="sky"
          glow
        />
      </div>

      {visibleInstances.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Rocket />
                </EmptyMedia>
                <EmptyTitle>Deploy your first agent</EmptyTitle>
                <EmptyDescription>
                  Launch an AI agent to start seeing health, spend, and activity here.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="gradient"
                  size="pill"
                  render={
                    <Link href="/dashboard/deploy">
                      <Plus data-icon="inline-start" />
                      Deploy Agent
                    </Link>
                  }
                />
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Row 1: Agent activity (left) + Credit runway (right) */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center gap-2">
                <BarChart3 className="size-4 text-primary" />
                <span className="text-base font-semibold text-foreground">Agent activity</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {totalRuns14d.toLocaleString()} run{totalRuns14d === 1 ? "" : "s"} in the last 14 days
              </p>
              <div className="mt-4">
                <ActivityChart data={runsPerDay} />
              </div>
            </div>

            <Card className="flex flex-col">
              <CardHeader>
                <CardDescription className="font-mono text-[11px] uppercase tracking-[0.12em] text-primary">
                  Credit runway
                </CardDescription>
                <CardTitle className="text-base">Wallet</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <div>
                  <p className="text-3xl font-bold tabular-nums text-foreground">
                    {credits.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">credits left</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Runway</span>
                    <span className="font-mono text-foreground">
                      {runwayDays === null
                        ? "—"
                        : runwayDays > 999
                          ? "999+ days"
                          : `${runwayDays} day${runwayDays === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${runwayPct}%` }}
                    />
                  </div>
                </div>

                <div className="mt-auto space-y-px">
                  <div className="flex items-center justify-between border-t border-border py-2.5 text-xs">
                    <span className="text-muted-foreground">Daily burn</span>
                    <span className="font-mono text-foreground">
                      {dailyBurnCredits > 0
                        ? `${dailyBurnCredits.toLocaleString()} cr/day`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border py-2.5 text-xs">
                    <span className="text-muted-foreground">Auto-pause below</span>
                    <span className="font-mono text-foreground">
                      {autoPauseBelow > 0 ? `${autoPauseBelow.toLocaleString()} cr` : "—"}
                    </span>
                  </div>
                </div>

                <Button
                  variant="gradient"
                  className="w-full"
                  render={<Link href="/dashboard/billing">Top up credits</Link>}
                />
              </CardContent>
            </Card>
          </div>

          {/* Row 2: Daily spend (left) + Avg latency (right) */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center gap-2">
                <Coins className="size-4 text-amber-400" />
                <span className="text-base font-semibold text-foreground">Daily spend</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Compute credits charged per day (last 7 days)
              </p>
              <div className="mt-4">
                {dailySpend.length > 0 ? (
                  <SpendChart data={dailySpend} />
                ) : (
                  <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
                    No compute charges yet.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center gap-2">
                <Gauge className="size-4 text-cyan-400" />
                <span className="text-base font-semibold text-foreground">Avg latency (24h)</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {latestLatencyMs === null
                  ? "Awaiting uptime samples"
                  : `Currently ~${latestLatencyMs.toLocaleString()} ms`}
              </p>
              <div className="mt-4">
                {latencySeries.length > 0 ? (
                  <LatencyChart data={latencySeries} />
                ) : (
                  <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
                    No latency data yet.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Affordance to the full agents list (agents live on /dashboard/instances). */}
          <div className="mt-4 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              render={
                <Link href="/dashboard/instances">
                  View all agents
                  <ChevronRight data-icon="inline-end" />
                </Link>
              }
            />
          </div>
        </>
      )}
    </PageContainer>
  )
}
