import Link from "next/link"
import { redirect } from "next/navigation"
import { Server, Plus, KeyRound, Wallet } from "lucide-react"

import { auth } from "@/auth"
import { db, desc, instances } from "@/db"
import { Badge } from "@/components/ui/badge"
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

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default",
  provisioning: "secondary",
  pending: "secondary",
  stopped: "outline",
  failed_provisioning: "destructive",
}

export default async function ByosPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const rows = await db.query.instances.findMany({
    where: whereUserInstancesVisible(session.user.id),
    orderBy: desc(instances.createdAt),
  })

  const items = rows.filter(
    (i) => i.deploymentTarget === "byos" && i.status !== "deleted",
  )

  return (
    <PageContainer>
      <PageHeader
        title="Bring Your Own Server"
        description="Servers you own that we manage. We deploy and run your agent on them for a flat fee."
        actions={
          <Button
            variant="gradient"
            size="pill"
            render={
              <Link href="/dashboard/byos/connect">
                <Plus data-icon="inline-start" />
                Connect a server
              </Link>
            }
          />
        }
      />

      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Server />
            </EmptyMedia>
            <EmptyTitle>No connected servers yet</EmptyTitle>
            <EmptyDescription>
              Connect a server you own and we&apos;ll act as its management
              panel — deploy, monitor, restart, and configure your agent.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="gradient"
              size="pill"
              render={
                <Link href="/dashboard/byos/connect">
                  <Plus data-icon="inline-start" />
                  Connect a server
                </Link>
              }
            />
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((i) => (
            <Link key={i.id} href={`/dashboard/instances/${i.id}`}>
              <Card className="transition-colors hover:border-foreground/30">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-medium">
                      <Server className="size-4 text-muted-foreground" />
                      {i.name}
                    </div>
                    <Badge variant={STATUS_VARIANT[i.status] ?? "outline"}>
                      {i.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {i.byosUser ?? "root"}@{i.byosHost ?? i.ipAddress ?? "—"}
                    {i.byosPort && i.byosPort !== 22 ? `:${i.byosPort}` : ""}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {i.byosLlmMode === "own_key" ? (
                      <>
                        <KeyRound className="size-3.5" /> Your own API key
                      </>
                    ) : (
                      <>
                        <Wallet className="size-3.5" /> Our OpenRouter credits
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
