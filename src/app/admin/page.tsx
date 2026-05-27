import Link from "next/link"

import { db, eq, sql, instances, users, subscriptions } from "@/db"
import { Badge } from "@/components/ui/badge"
import { runtimeLabel } from "@/lib/runtimes/labels"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageContainer, PageHeader, PageSection } from "@/components/layout/page-container"

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running":
      return "default"
    case "failed":
    case "failed_provisioning":
      return "destructive"
    case "provisioning":
    case "pending":
      return "outline"
    default:
      return "secondary"
  }
}

export default async function AdminDashboard() {
  const [
    totalUsersRows,
    activeInstancesRows,
    totalInstancesRows,
    activeSubscriptionsRows,
    stoppedInstancesRows,
    bannedUsersRows,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.role, "user")),
    db.select({ count: sql<number>`count(*)` }).from(instances).where(eq(instances.status, "running")),
    db.select({ count: sql<number>`count(*)` }).from(instances),
    db.select({ count: sql<number>`count(*)` }).from(subscriptions).where(eq(subscriptions.status, "active")),
    db.select({ count: sql<number>`count(*)` }).from(instances).where(eq(instances.status, "stopped")),
    db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.isBanned, true)),
  ])

  const totalUsers = Number(totalUsersRows[0]?.count ?? 0)
  const activeInstances = Number(activeInstancesRows[0]?.count ?? 0)
  const totalInstances = Number(totalInstancesRows[0]?.count ?? 0)
  const activeSubscriptions = Number(activeSubscriptionsRows[0]?.count ?? 0)
  const stoppedInstances = Number(stoppedInstancesRows[0]?.count ?? 0)
  const bannedUsers = Number(bannedUsersRows[0]?.count ?? 0)

  const recentInstances = await db.query.instances.findMany({
    with: { user: true, region: true, serverConfig: true },
    orderBy: (t, { desc }) => desc(t.createdAt),
    limit: 10,
  })

  const stats = [
    { label: "Total Users", value: totalUsers, accent: false },
    { label: "Active Instances", value: activeInstances, accent: true },
    { label: "Total Instances", value: totalInstances, accent: false },
    { label: "Active Subs", value: activeSubscriptions, accent: false },
  ]

  return (
    <PageContainer>
      <PageHeader title="Admin Dashboard" description="Operational overview of the platform." />

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
          </Card>
        ))}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardDescription className="text-xs">Stopped Instances</CardDescription>
            <CardTitle className="text-3xl font-bold text-muted-foreground">
              {stoppedInstances}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription className="text-xs">Banned Users</CardDescription>
            <CardTitle className="text-3xl font-bold text-destructive">{bannedUsers}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <PageSection
        title="Recent Instances"
        actions={
          <Link href="/admin/instances" className="text-sm font-medium text-primary hover:underline">
            View All &rarr;
          </Link>
        }
      >
        {recentInstances.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">No instances yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentInstances.map((instance) => (
              <Card key={instance.id} className="transition-colors hover:bg-accent/40">
                <CardContent className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">{instance.name}</p>
                    <p className="text-sm text-muted-foreground">{instance.user.email}</p>
                    <p className="font-mono text-xs text-muted-foreground">{instance.slug}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant={statusBadgeVariant(instance.status)} className="font-mono">
                      {instance.status}
                    </Badge>
                    {instance.deploymentTarget === "vps" && (
                      <Badge variant="outline" className="ml-2 font-mono">
                        {runtimeLabel(instance.runtime)}
                      </Badge>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {instance.region.flag} {instance.region.name} &middot;{" "}
                      {instance.serverConfig.label}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>
    </PageContainer>
  )
}
