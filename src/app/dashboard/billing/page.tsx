import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowDownRight, ArrowUpRight, Coins } from "lucide-react"

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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

  const credits = Math.round(wallet.balance)
  const minimumCredits = Math.round(wallet.minimumBalance)
  const daysOfRunway =
    dailyBurnCredits > 0 ? Math.max(0, Math.floor(credits / dailyBurnCredits)) : null

  const activeSubs = subs.filter((s) => s.status === "active")
  const stripeOn = isStripeConfigured()

  // Re-fetch one more time so that the SSR balance reflects any deposit
  // that just landed via the wallet creation path. (No-op for existing wallets.)
  const liveBalance = await db.query.wallets.findFirst({
    where: eq(wallets.userId, userId),
    columns: { balance: true },
  })
  const liveCredits = Math.round(liveBalance?.balance ?? credits)

  return (
    <PageContainer>
      <PageHeader
        title="Billing"
        description="Everything you spend runs on credits. 1 credit = $0.01 USD."
      />

      {/* ─── Hero stats ─────────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardDescription className="font-mono text-[10px] tracking-[0.1em] uppercase text-primary">
              Credit Balance
            </CardDescription>
            <CardTitle className="flex items-baseline gap-3 text-4xl font-bold text-foreground">
              <Coins className="size-7 text-primary" />
              {liveCredits.toLocaleString()}
              <span className="text-base font-normal text-muted-foreground">
                credits
              </span>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              ≈ {formatCreditsAsUsd(liveCredits)} of usable balance
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Stat
              label="Daily burn"
              value={`${dailyBurnCredits.toLocaleString()} cr`}
              hint={
                dailyBurnCredits > 0
                  ? `≈ $${creditsToUsd(dailyBurnCredits).toFixed(2)}/day · compute + AI`
                  : "no recent spend"
              }
            />
            <Stat
              label="Runway"
              value={
                daysOfRunway === null
                  ? "—"
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
              label="Auto-pause at"
              value={`${minimumCredits.toLocaleString()} cr`}
              hint="agents stop below this"
            />
          </CardContent>
        </Card>
        <TopUpCard stripeConfigured={stripeOn} />
      </div>

      {/* ─── Subscriptions ──────────────────────────────────────── */}
      <PageSection
        title="Your plans"
        actions={
          activeSubs.length > 0 ? (
            <Button variant="outline" size="sm" render={<Link href="/dashboard/deploy">Deploy another</Link>} />
          ) : null
        }
      >
        {subs.length === 0 ? (
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
            {subs.map((sub) => {
              const cfg = findPlanBySlug(sub.plan?.slug ?? "")
              const includedCredits = sub.plan?.creditsPerPeriod ?? 0
              return (
                <Card key={sub.id}>
                  <CardContent className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium text-foreground">
                          {sub.plan.name} Plan
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
                          · {sub.instance.region.name} · {sub.instance.serverConfig.label}
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
            })}
          </div>
        )}
      </PageSection>

      {/* ─── Usage by agent (30d) ───────────────────────────────── */}
      {agentBreakdown.length > 0 && (
        <PageSection
          title="Usage by agent"
          description="Credits spent in the last 30 days, split by compute and AI usage."
        >
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
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {a.compute.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {a.api.toLocaleString()}
                    </TableCell>
                    <TableCell className="pr-5 text-right font-mono text-sm font-medium text-foreground">
                      {a.total.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </PageSection>
      )}

      {/* ─── Transaction history ────────────────────────────────── */}
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
                      <TableCell className="pl-5 text-sm text-muted-foreground">
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
                          tx.description || "—"
                        )}
                      </TableCell>
                      <TableCell
                        className={
                          isDebit
                            ? "text-right font-mono text-sm text-destructive"
                            : "text-right font-mono text-sm text-emerald-600 dark:text-emerald-400"
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
                      <TableCell className="pr-5 text-right font-mono text-sm text-foreground">
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

      {stripeOn && (
        <div className="max-w-md">
          <BillingPortalButton />
        </div>
      )}
    </PageContainer>
  )
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border bg-muted/30 px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
