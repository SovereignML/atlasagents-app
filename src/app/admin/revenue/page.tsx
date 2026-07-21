import { db, eq, instances, subscriptions } from "@/db"
import { requireAdminPage } from "@/lib/admin-guard"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageContainer, PageHeader, PageSection } from "@/components/layout/page-container"
import { Badge } from "@/components/ui/badge"
import { runtimeLabel } from "@/lib/runtimes/labels"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default async function AdminRevenuePage() {
  await requireAdminPage()
  const [activeSubs, runningInstances] = await Promise.all([
    // Only the count is rendered below, so select a single column. Loading
    // the nested `instance` relation here builds a json_build_object() over
    // Instance's 77 columns, which overflows Postgres' 100-argument cap
    // ("cannot pass more than 100 arguments to a function").
    db.query.subscriptions.findMany({
      where: eq(subscriptions.status, "active"),
      columns: { id: true },
    }),
    // Narrow to the columns this page actually reads — keeps the nested
    // serverConfig json_build_object() well under the 100-argument cap.
    db.query.instances.findMany({
      where: eq(instances.status, "running"),
      columns: {
        id: true,
        name: true,
        slug: true,
        runtime: true,
        billingInterval: true,
        deploymentTarget: true,
      },
      with: {
        serverConfig: {
          columns: { label: true, priceMonthly: true, priceYearly: true },
        },
      },
    }),
  ])

  const monthlyRecurring = runningInstances.reduce((sum, inst) => {
    if (inst.billingInterval === "year") {
      return sum + inst.serverConfig.priceYearly / 12
    }
    return sum + inst.serverConfig.priceMonthly
  }, 0)

  return (
    <PageContainer>
      <PageHeader
        title="Revenue"
        description="Estimated recurring revenue from active instances."
      />

      <div className="grid gap-5 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardDescription>Est. MRR</CardDescription>
            <CardTitle className="text-3xl font-bold text-primary">
              ${monthlyRecurring.toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Active Subscriptions</CardDescription>
            <CardTitle className="text-3xl font-bold text-foreground">
              {activeSubs.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Running Instances</CardDescription>
            <CardTitle className="text-3xl font-bold text-foreground">
              {runningInstances.length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <PageSection title="Active Instance Revenue">
        {runningInstances.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No running instances</EmptyTitle>
              <EmptyDescription>
                Revenue will be tracked here once instances are provisioned.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Card className="overflow-hidden p-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instance</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead className="text-center">Billing</TableHead>
                    <TableHead className="text-right">Monthly Equiv.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runningInstances.map((inst) => {
                    const monthly =
                      inst.billingInterval === "year"
                        ? inst.serverConfig.priceYearly / 12
                        : inst.serverConfig.priceMonthly
                    return (
                      <TableRow key={inst.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-foreground">{inst.name}</p>
                            {inst.deploymentTarget === "vps" && (
                              <Badge variant="outline" className="font-mono">
                                {runtimeLabel(inst.runtime)}
                              </Badge>
                            )}
                          </div>
                          <p className="font-mono text-xs text-muted-foreground">{inst.slug}</p>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {inst.serverConfig.label}
                        </TableCell>
                        <TableCell className="text-center capitalize text-muted-foreground">
                          {inst.billingInterval === "year" ? "Yearly" : "Monthly"}
                        </TableCell>
                        <TableCell className="text-right font-medium text-foreground">
                          ${monthly.toFixed(2)}/mo
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </PageSection>
    </PageContainer>
  )
}
