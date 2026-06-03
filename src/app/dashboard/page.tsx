import Link from "next/link"
import { redirect } from "next/navigation"
import { Plus, Rocket, Activity, Bot, Coins } from "lucide-react"

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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { PageContainer, PageHeader, PageSection } from "@/components/layout/page-container"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { getEffectiveUserId } from "@/lib/effective-user"
import { usdToCredits, creditsToUsd } from "@/lib/credit-pricing"
import { runtimeLabel } from "@/lib/runtimes/labels"

type InstanceStatus = "running" | "provisioning" | "stopped" | "failed" | "deleted" | string

function statusBadgeVariant(status: InstanceStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running":
      return "default"
    case "failed":
      return "destructive"
    case "provisioning":
      return "outline"
    case "deleted":
    case "stopped":
    default:
      return "secondary"
  }
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id

  // Server component: this runs once per request, so reading the clock is not
  // the impure render react-hooks/purity guards against (which targets client
  // components re-rendered by the React Compiler).
  // eslint-disable-next-line react-hooks/purity
  const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [allInstances, allSubscriptions, walletRow, incidents24Rows] = await Promise.all([
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
  ])

  const activeInstances = allInstances.filter((i) => i.status === "running").length
  const activeSubs = allSubscriptions.filter((s) => s.status === "active").length
  const credits = Math.round(walletRow?.balance ?? 0)
  const dailyBurnUsd = allInstances
    .filter((i) => i.status === "running")
    .reduce((sum, i) => sum + i.serverConfig.priceMonthly / 30, 0)
  const dailyBurnCredits = usdToCredits(dailyBurnUsd)
  const runwayDays =
    dailyBurnCredits > 0 ? Math.max(0, Math.floor(credits / dailyBurnCredits)) : null
  const incidents24 = Number(incidents24Rows[0]?.count ?? 0)

  const stats = [
    {
      label: "Active Agents",
      value: activeInstances.toString(),
      hint: `of ${allInstances.length} total`,
      accent: true,
    },
    {
      label: "Credits",
      value: credits.toLocaleString(),
      hint:
        dailyBurnCredits > 0
          ? `${dailyBurnCredits.toLocaleString()} cr/day burn`
          : "no running agents",
    },
    {
      label: "Runway",
      value:
        runwayDays === null
          ? "—"
          : runwayDays > 999
            ? "999+ days"
            : `${runwayDays} day${runwayDays === 1 ? "" : "s"}`,
      hint:
        runwayDays === null
          ? `${activeSubs} active plan${activeSubs === 1 ? "" : "s"}`
          : `at ~$${creditsToUsd(dailyBurnCredits).toFixed(2)}/day`,
    },
    {
      label: "Incidents 24h",
      value: incidents24.toString(),
      hint: incidents24 === 0 ? "all systems up" : "check monitoring",
    },
  ]

  const quickActions = [
    {
      href: "/dashboard/deploy",
      label: "Quick Action",
      title: "Deploy new agent",
      hint: "From template or scratch",
      icon: Rocket,
    },
    {
      href: "/dashboard/monitoring",
      label: "Health",
      title: "Monitoring",
      hint: "Uptime + latency across agents",
      icon: Activity,
    },
    {
      href: "/dashboard/billing",
      label: "Billing",
      title: "Credits & plans",
      hint: "Top up credits, manage plans, view history",
      icon: Coins,
    },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        description="Manage your AI agents"
        actions={
          <Button
            variant="gradient"
            size="pill"
            render={
              <Link href="/dashboard/deploy">
                <Plus data-icon="inline-start" />
                Deploy New
              </Link>
            }
          />
        }
      />

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} size="sm">
            <CardHeader>
              <CardDescription className="text-xs">{stat.label}</CardDescription>
              <CardTitle
                className={
                  stat.accent
                    ? "text-3xl font-bold text-primary"
                    : "text-3xl font-bold text-foreground"
                }
              >
                {stat.value}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{stat.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {quickActions.map((qa) => {
          const Icon = qa.icon
          return (
            <Link key={qa.href} href={qa.href} className="block transition-transform hover:-translate-y-0.5">
              <Card className="h-full">
                <CardHeader>
                  <CardAction>
                    <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </div>
                  </CardAction>
                  <CardDescription className="text-xs font-medium uppercase tracking-wider text-primary">
                    {qa.label}
                  </CardDescription>
                  <CardTitle className="text-base">{qa.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{qa.hint}</p>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      <PageSection title="Your Agents">
        {allInstances.length === 0 ? (
          <Card>
            <CardContent className="py-6">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Bot />
                  </EmptyMedia>
                  <EmptyTitle>No agents deployed yet</EmptyTitle>
                  <EmptyDescription>Launch your first AI agent to get started.</EmptyDescription>
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
          <Card className="overflow-hidden p-0">
            <Table>
              <TableBody>
                {allInstances.map((instance) => (
                  <TableRow key={instance.id} className="cursor-pointer">
                    <TableCell className="p-0">
                      <Link
                        href={`/dashboard/instances/${instance.id}`}
                        className="block p-5 hover:bg-accent/40"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">{instance.name}</p>
                            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                              {instance.slug}
                            </p>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right text-sm">
                              <p className="font-mono text-xs text-muted-foreground">
                                {instance.serverConfig.label} &middot; {instance.serverConfig.vcpu} vCPU &middot; {instance.serverConfig.ramGb} GB
                              </p>
                              {instance.status === "running" && (
                                <p className="font-mono text-xs text-muted-foreground">
                                  ~${(instance.serverConfig.priceMonthly / 30).toFixed(2)}/day
                                </p>
                              )}
                            </div>
                            <Badge variant={statusBadgeVariant(instance.status)}>
                              {instance.status}
                            </Badge>
                            {instance.deploymentTarget === "vps" && (
                              <Badge variant="outline">{runtimeLabel(instance.runtime)}</Badge>
                            )}
                          </div>
                        </div>
                        {instance.ipAddress && (
                          <p className="mt-2 font-mono text-xs text-muted-foreground">
                            IP: {instance.ipAddress}
                          </p>
                        )}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </PageSection>
    </PageContainer>
  )
}
