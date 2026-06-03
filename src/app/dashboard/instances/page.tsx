import Link from "next/link"
import { redirect } from "next/navigation"
import { Bot, Plus } from "lucide-react"

import { auth } from "@/auth"
import { db, desc, instances } from "@/db"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { whereUserInstancesVisible } from "@/lib/instance-queries"
import { InstancesFilter } from "./instances-filter"

export default async function InstancesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const rows = await db.query.instances.findMany({
    where: whereUserInstancesVisible(session.user.id),
    with: {
      region: true,
      serverConfig: true,
      logs: {
        orderBy: (logs, { desc: d }) => d(logs.createdAt),
        limit: 3,
      },
    },
    orderBy: desc(instances.createdAt),
  })

  const items = rows
    .filter((i) => i.status !== "deleted")
    .map((i) => ({
      id: i.id,
      name: i.name,
      slug: i.slug,
      status: i.status,
      ipAddress: i.ipAddress,
      runtime: i.runtime,
      deploymentTarget: i.deploymentTarget,
      serverLabel: i.serverConfig.label,
      vcpu: i.serverConfig.vcpu,
      ramGb: i.serverConfig.ramGb,
      recentLogs: i.logs.map((l) => ({
        id: l.id,
        level: l.level,
        message: l.message,
        createdAt: l.createdAt.toISOString(),
      })),
    }))

  return (
    <PageContainer>
      <PageHeader
        title="Instances"
        description="All your deployed AI agents"
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

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Bot />
                </EmptyMedia>
                <EmptyTitle>No instances yet</EmptyTitle>
                <EmptyDescription>Deploy your first agent to populate this list.</EmptyDescription>
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
        <InstancesFilter items={items} />
      )}
    </PageContainer>
  )
}
