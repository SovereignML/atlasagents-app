import Link from "next/link"
import { redirect } from "next/navigation"
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Clock,
  Coins,
  PauseCircle,
  TrendingDown,
  TriangleAlert,
} from "lucide-react"

import { auth } from "@/auth"
import {
  db,
  eq,
  and,
  gte,
  lt,
  sql,
  desc,
  instances,
  subscriptions,
  walletTransactions,
  wallets,
} from "@/db"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { PageContainer, PageHeader, PageSection } from "@/components/layout/page-container"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { findPlanBySlug } from "@/configs/plans"
import { getOrCreateWallet } from "@/lib/wallet"
import { isStripeConfigured } from "@/lib/stripe"
import {
  creditsToUsd,
  formatCreditsAsUsd,
  usdToCredits,
} from "@/lib/credit-pricing"
import { BillingPortalButton } from "./portal-button"
import { TopUpCard } from "./topup-card"

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
      return "default"
    case "canceled":
      return "destructive"
    case "past_due":
      return "outline"
    case "incomplete":
    default:
      return "secondary"
  }
}

const TX_LABEL: Record<string, string> = {
  plan_deposit: "Plan grant",
  topup: "Top-up",
  daily_compute: "Daily compute",
  api_usage: "API usage",
  admin_grant: "Admin grant",
  refund: "Refund",
}

function txLabel(t: string): string {
  return TX_LABEL[t] ?? t
}

type Health = "idle" | "healthy" | "low" | "critical"

export default async function BillingPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const userId = session.user.id

  const wallet = await getOrCreateWallet(userId)

  const since30 = new Date(Date.now() - 30 * 86_400_000)
  const since7 = new Date(Date.now() - 7 * 86_400_000)

  const [transactions, subs, byAgentRows, apiUsage7, userInstances] = await Promise.all([
    db.query.walletTransactions.findMany({
      where: eq(walletTransactions.walletId, wallet.id),
      orderBy: desc(walletTransactions.createdAt),
      limit: 20,
      with: { instance: { columns: { id: true, name: true, status: true } } },
    }),
    db.query.subscriptions.findMany({
      where: eq(subscriptions.userId, userId),
      with: {
        plan: true,
        instance: { with: { serverConfig: true, region: true } },
      },
      orderBy: desc(subscriptions.createdAt),
    }),
    // Debits (spend) per agent × type over the last 30 days.
    db
      .select({
        instanceId: walletTransactions.instanceId,
        type: walletTransactions.type,
        credits: sql<number>`COALESCE(SUM(-${walletTransactions.amount}), 0)`,
      })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.walletId, wallet.id),
          lt(walletTransactions.amount, 0),
          gte(walletTransactions.createdAt, since30),
        ),
      )
      .groupBy(walletTransactions.instanceId, walletTransactions.type),
    // AI usage over the last 7 days → a per-day estimate for the burn rate.
    db
      .select({ credits: sql<number>`COALESCE(SUM(-${walletTransactions.amount}), 0)` })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.walletId, wallet.id),
          eq(walletTransactions.type, "api_usage"),
          gte(walletTransactions.createdAt, since7),
        ),
      ),
    db.query.instances.findMany({
      where: eq(instances.userId, userId),
      columns: { id: true, name: true, status: true },
    }),
  ])

  // Burn rate = compute (running instances, USD/day) + a 7-day average of AI
  // usage. Including AI usage makes the runway estimate realistic for agents
  // that spend mostly on the model, not the box.
  const computeBurnCredits = subs
    .filter(
      (s) =>
        s.status === "active" &&
        s.instance &&
        s.instance.status !== "deleted" &&
        s.instance.status === "running",
    )
    .reduce((sum, s) => {
      if (!s.instance) return sum
      const dailyUsd = s.instance.serverConfig.priceMonthly / 30
      return sum + usdToCredits(dailyUsd)
    }, 0)
  const apiBurnCredits = Math.round(Number(apiUsage7[0]?.credits ?? 0) / 7)
  const dailyBurnCredits = computeBurnCredits + apiBurnCredits

  // Per-agent spend breakdown (30d), keyed by instance id (null → "Account").
  const instanceName = new Map(userInstances.map((i) => [i.id, i.name]))
  const byAgent = new Map<string, { name: string; compute: number; api: number }>()
  for (const r of byAgentRows) {
    const key = r.instanceId ?? "__account__"
    const entry =
      byAgent.get(key) ??
      { name: r.instanceId ? (instanceName.get(r.instanceId) ?? "Removed agent") : "Account", compute: 0, api: 0 }
    const credits = Math.round(Number(r.credits))
    if (r.type === "daily_compute") entry.compute += credits
    else if (r.type === "api_usage") entry.api += credits
    byAgent.set(key, entry)
  }
  const agentBreakdown = [...byAgent.values()]
    .map((e) => ({ ...e, total: e.compute + e.api }))
    .filter((e) => e.total > 0)
    .sort((a, b) => b.total - a.total)
  const spend30 = agentBreakdown.reduce((sum, a) => sum + a.total, 0)

  const credits = Math.round(wallet.balance)
  const minimumCredits = Math.round(wallet.minimumBalance)
  const daysOfRunway =
    dailyBurnCredits > 0 ? Math.max(0, Math.floor(credits / dailyBurnCredits)) : null

  const activeSubs = subs.filter((s) => s.status === "active")
  // Current (active / past_due / incomplete) plans stay in the list; canceled
  // ones are collapsed behind a toggle so they don't bury the live plans.
  const currentSubs = subs.filter((s) => s.status !== "canceled")
  const canceledSubs = subs.filter((s) => s.status === "canceled")
  const stripeOn = isStripeConfigured()

  // Re-fetch one more time so that the SSR balance reflects any deposit
  // that just landed via the wallet creation path. (No-op for existing wallets.)
  const liveBalance = await db.query.wallets.findFirst({
    where: eq(wallets.userId, userId),
    columns: { balance: true },
  })
  const liveCredits = Math.round(liveBalance?.balance ?? credits)

  // ─── Account health ────────────────────────────────────────────
  // Folds runway and the auto-pause threshold into one signal that
  // drives the hero accent, the runway bar, and the warning banner.
  const belowMinimum = minimumCredits > 0 && liveCredits <= minimumCredits
  const health: Health =
    daysOfRunway === null
      ? "idle"
      : daysOfRunway < 7 || belowMinimum
        ? "critical"
        : daysOfRunway < 14
          ? "low"
          : "healthy"

  // Runway bar fills toward a comfortable 30-day target.
  const runwayPct =
    daysOfRunway === null ? 0 : Math.min(100, Math.round((daysOfRunway / 30) * 100))

  // Single lime accent (your --secondary token: #a3e635 in the dark app-shell)
  // across every runway state — no emerald/amber/red.
  const HEALTH_BAR: Record<Health, string> = {
    idle: "bg-muted-foreground/40",
    healthy: "bg-primary",
    low: "bg-primary",
    critical: "bg-primary",
  }
  const HEALTH_TEXT: Record<Health, string> = {
    idle: "text-muted-foreground",
    healthy: "text-primary",
    low: "text-primary",
    critical: "text-primary",
  }

  const renderPlan = (sub: (typeof subs)[number]) => {
    const cfg = findPlanBySlug(sub.plan?.slug ?? "")
    const includedCredits = sub.plan?.creditsPerPeriod ?? 0
    return (
      <Card key={sub.id} className="transition-shadow hover:shadow-[var(--shadow-hover)]">
        <CardContent className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-foreground">
                {sub.plan?.name ?? "Subscription"}{sub.plan ? " Plan" : ""}
              </h3>
              <Badge variant={statusBadgeVariant(sub.status)}>
                {sub.status}
              </Badge>
              {includedCredits > 0 && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {includedCredits.toLocaleString()} cr / {sub.interval === "year" ? "yr" : "mo"}
                </Badge>
              )}
            </div>
            {sub.instance && sub.instance.status === "deleted" ? (
              <p className="text-sm text-muted-foreground">Agent removed</p>
            ) : sub.instance ? (
              <p className="text-sm text-muted-foreground">
                <Link
                  href={`/dashboard/instances/${sub.instance.id}`}
                  className="hover:text-foreground"
                >
                  {sub.instance.name}
                </Link>{" "}
                · {sub.instance.serverConfig.label}
              </p>
            ) : null}
            {sub.currentPeriodEnd && (
              <p className="font-mono text-[11px] text-muted-foreground">
                Renews {sub.currentPeriodEnd.toISOString().slice(0, 10)}
              </p>
            )}
          </div>
          {cfg && cfg.tier !== "free" && (
            <div className="text-right">
              <p className="font-semibold text-foreground">
                ${(sub.interval === "year"
                  ? cfg.displayPriceYearly
                  : cfg.displayPriceMonthly
                ).toFixed(0)}
                <span className="text-xs font-normal text-muted-foreground">
                  /{sub.interval === "year" ? "yr" : "mo"}
                </span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Billing"
        description="Everything you spend runs on credits. 1 credit = $0.01 USD."
        actions={
          stripeOn ? <BillingPortalButton variant="inline" /> : undefined
        }
      />

      {/* ─── Low-balance warning ────────────────────────────────── */}
      {(health === "critical" || health === "low") && (
        <div className="flex items-start gap-3 rounded-[14px] border border-primary/30 border-l-[3px] border-l-primary bg-primary/10 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">
              {belowMinimum
                ? "Balance at or below the auto-pause threshold"
                : health === "critical"
                  ? "Low balance. Top up to keep your agents running"
                  : "Running low on credits"}
            </p>
            <p className="text-[0.8rem] text-muted-foreground">
              {daysOfRunway !== null
                ? `At your current burn you have about ${daysOfRunway} day${daysOfRunway === 1 ? "" : "s"} of runway left. Agents auto-pause below ${minimumCredits.toLocaleString()} credits.`
                : `Agents auto-pause below ${minimumCredits.toLocaleString()} credits.`}
            </p>
          </div>
        </div>
      )}

      {/* ─── Hero: balance + top up ─────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardDescription className="font-mono text-[10px] tracking-[0.1em] uppercase text-muted-foreground">
              Credit Balance
            </CardDescription>
            <CardTitle className="flex items-center gap-3 text-foreground">
              <span className="flex size-[54px] items-center justify-center rounded-xl bg-[linear-gradient(160deg,color-mix(in_oklch,var(--primary)_78%,white),var(--primary))] text-primary-foreground shadow-[0_6px_18px_color-mix(in_oklch,var(--primary)_35%,transparent)]">
                <Coins className="size-5" />
              </span>
              <span className="flex items-baseline gap-2">
                <span className="text-4xl font-bold tracking-tight tabular-nums">
                  {liveCredits.toLocaleString()}
                </span>
                <span className="text-base font-normal text-muted-foreground">
                  credits
                </span>
              </span>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              ≈ {formatCreditsAsUsd(liveCredits)} of usable balance
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Runway health bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[0.8rem]">
                <span className="text-muted-foreground">Runway</span>
                <span className={cn("font-medium", HEALTH_TEXT[health])}>
                  {daysOfRunway === null
                    ? "No recent spend"
                    : daysOfRunway > 999
                      ? "999+ days left"
                      : `${daysOfRunway} day${daysOfRunway === 1 ? "" : "s"} left`}
                </span>
              </div>
              <Progress
                value={daysOfRunway === null ? 0 : Math.max(runwayPct, 4)}
                indicatorClassName={HEALTH_BAR[health]}
              />
            </div>

            <div className="grid grid-cols-1 divide-y rounded-xl border bg-muted/30 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <Stat
                icon={<TrendingDown className="size-3.5" />}
                label="Daily burn"
                value={`${dailyBurnCredits.toLocaleString()} cr`}
                hint={
                  dailyBurnCredits > 0
                    ? `≈ $${creditsToUsd(dailyBurnCredits).toFixed(2)}/day · compute + AI`
                    : "no recent spend"
                }
              />
              <Stat
                icon={<Clock className="size-3.5" />}
                label="Runway"
                tone={HEALTH_TEXT[health]}
                value={
                  daysOfRunway === null
                    ? "-"
                    : daysOfRunway > 999
                      ? "999+ days"
                      : `${daysOfRunway} day${daysOfRunway === 1 ? "" : "s"}`
                }
                hint={
                  daysOfRunway === null
                    ? "depends on usage"
                    : daysOfRunway < 7
                      ? "top up soon"
                      : "at current burn"
                }
              />
              <Stat
                icon={<PauseCircle className="size-3.5" />}
                label="Auto-pause at"
                value={`${minimumCredits.toLocaleString()} cr`}
                hint="agents stop below this"
              />
            </div>
          </CardContent>
        </Card>
        <TopUpCard stripeConfigured={stripeOn} />
      </div>

      {/* ─── Tabbed sections: Plans · Usage · History ───────────── */}
      <Tabs defaultValue="plans">
        <TabsList
          variant="line"
          className="w-full justify-start gap-1 border-b [&_[data-active]]:text-foreground [&_[data-active]]:after:bg-primary"
        >
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* ─── Subscriptions ────────────────────────────────────── */}
        <TabsContent value="plans" className="pt-6">
      <PageSection
        title="Your plans"
        actions={
          activeSubs.length > 0 ? (
            <Button variant="outline" size="sm" render={<Link href="/dashboard/deploy">Deploy another</Link>} />
          ) : null
        }
      >
        {currentSubs.length === 0 && canceledSubs.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No plans yet</EmptyTitle>
                  <EmptyDescription>
                    Deploying an agent picks a plan and grants its credits.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {currentSubs.length > 0 ? (
              currentSubs.map(renderPlan)
            ) : (
              <p className="text-sm text-muted-foreground">
                No active plans. See canceled history below.
              </p>
            )}

            {canceledSubs.length > 0 && (
              <details className="group/canceled">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-sm text-muted-foreground transition-colors select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-4 transition-transform duration-200 group-open/canceled:rotate-90" />
                  Show {canceledSubs.length} canceled {canceledSubs.length === 1 ? "plan" : "plans"}
                </summary>
                <div className="mt-3 space-y-3 opacity-55">
                  {canceledSubs.map(renderPlan)}
                </div>
              </details>
            )}
          </div>
        )}
      </PageSection>
        </TabsContent>

        {/* ─── Usage by agent (30d) ─────────────────────────────── */}
        <TabsContent value="usage" className="pt-6">
        <PageSection
          title="Usage by agent"
          description="Credits spent in the last 30 days, split by compute and AI usage."
          actions={
            agentBreakdown.length > 0 ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                {spend30.toLocaleString()} cr · 30d
              </Badge>
            ) : null
          }
        >
          {agentBreakdown.length === 0 ? (
            <Card>
              <CardContent className="py-8">
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No usage yet</EmptyTitle>
                    <EmptyDescription>
                      Per-agent spend appears here once your agents start running.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </CardContent>
            </Card>
          ) : (
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Agent</TableHead>
                  <TableHead className="text-right">Compute</TableHead>
                  <TableHead className="text-right">AI usage</TableHead>
                  <TableHead className="pr-5 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentBreakdown.map((a) => (
                  <TableRow key={a.name}>
                    <TableCell className="pl-5 font-medium text-foreground">{a.name}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground tabular-nums">
                      {a.compute.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground tabular-nums">
                      {a.api.toLocaleString()}
                    </TableCell>
                    <TableCell className="pr-5 text-right font-mono text-sm font-medium text-foreground tabular-nums">
                      {a.total.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          )}
        </PageSection>
        </TabsContent>

        {/* ─── Transaction history ──────────────────────────────── */}
        <TabsContent value="history" className="pt-6">
      <PageSection
        title="Recent activity"
        actions={
          transactions.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              render={<a href="/api/billing/statement">Download statement (CSV)</a>}
            />
          ) : null
        }
      >
        {transactions.length === 0 ? (
          <Card>
            <CardContent className="py-6">
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No transactions yet</EmptyTitle>
                  <EmptyDescription>
                    Deploy an agent or top up to see activity here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead className="pr-5 text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => {
                  const isDebit = tx.amount < 0
                  const amountAbs = Math.abs(Math.round(tx.amount))
                  return (
                    <TableRow key={tx.id}>
                      <TableCell className="pl-5 text-sm text-muted-foreground whitespace-nowrap">
                        {tx.createdAt.toISOString().slice(0, 10)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {txLabel(tx.type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                        {tx.instance ? (
                          <Link
                            href={`/dashboard/instances/${tx.instance.id}`}
                            className="hover:text-foreground"
                          >
                            {tx.instance.name}
                          </Link>
                        ) : (
                          tx.description || "-"
                        )}
                      </TableCell>
                      <TableCell
                        className={
                          isDebit
                            ? "text-right font-mono text-sm text-destructive tabular-nums"
                            : "text-right font-mono text-sm text-emerald-600 dark:text-emerald-400 tabular-nums"
                        }
                      >
                        <span className="inline-flex items-center gap-1">
                          {isDebit ? (
                            <ArrowDownRight className="size-3.5" />
                          ) : (
                            <ArrowUpRight className="size-3.5" />
                          )}
                          {isDebit ? "−" : "+"}
                          {amountAbs.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="pr-5 text-right font-mono text-sm text-foreground tabular-nums">
                        {Math.round(tx.balanceAfter).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </PageSection>
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}

function Stat({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string
  value: string
  hint?: string
  icon?: React.ReactNode
  tone?: string
}) {
  return (
    <div className="px-4 py-3">
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className={cn("mt-1 text-lg font-semibold text-foreground", tone)}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
