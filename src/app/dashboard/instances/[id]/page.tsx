import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { auth } from "@/auth"
import { db, eq, desc, driveConnections, cloudflareConnections, backupRecords } from "@/db"
import { isDriveConfigured } from "@/lib/google-drive"
import { isKumaConfigured } from "@/lib/uptime-kuma"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { PageContainer } from "@/components/layout/page-container"
import { buildPublicGatewayUrl } from "@/lib/instance-gateway-access"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { getInstanceAccessLevel, levelAtLeast } from "@/lib/instance-access"
import { getRuntime } from "@/lib/runtimes"
import { InstanceTabs } from "./instance-tabs"

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running":
      return "default"
    case "failed":
    case "failed_provisioning":
      return "destructive"
    case "pending":
    case "provisioning":
    case "deleting":
      return "outline"
    case "deleted":
    case "stopped":
    default:
      return "secondary"
  }
}

export default async function InstanceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const { id } = await params
  const { tab } = await searchParams

  const instance = await db.query.instances.findFirst({
    where: whereUserInstanceVisible(session.user.id, id),
    with: {
      region: true,
      serverConfig: true,
      logs: {
        orderBy: (logs, { desc }) => desc(logs.createdAt),
        limit: 50,
      },
    },
  })

  if (!instance) notFound()

  // Provider connections are team-shared (keyed by the agent's team).
  const driveConn = await db.query.driveConnections.findFirst({
    where: eq(driveConnections.teamId, instance.teamId),
  })
  const cloudflareConn = await db.query.cloudflareConnections.findFirst({
    where: eq(cloudflareConnections.teamId, instance.teamId),
  })
  const backupRows = await db.query.backupRecords.findMany({
    where: eq(backupRecords.instanceId, instance.id),
    orderBy: desc(backupRecords.createdAt),
  })

  // The viewer's effective access level drives which controls/tabs render.
  const myAccess = await getInstanceAccessLevel(session.user.id, instance.id)
  const accessControl = {
    level: myAccess.level,
    canOperate: levelAtLeast(myAccess.level, "operator"),
    canManageAccess: levelAtLeast(myAccess.level, "manager"),
    isOwnerLike: myAccess.isOwnerLike,
  }

  const access = buildPublicGatewayUrl({
    ipAddress: instance.ipAddress,
    domain: instance.domain,
    managedSubdomain: instance.managedSubdomain,
    tlsStatus: instance.tlsStatus,
  })

  return (
    <PageContainer>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/dashboard">Dashboard</Link>} />
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/dashboard/instances">Instances</Link>} />
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{instance.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{instance.name}</h1>
            <Badge variant={statusBadgeVariant(instance.status)}>{instance.status}</Badge>
          </div>
          <p className="font-mono text-xs text-muted-foreground">{instance.slug}</p>
        </div>
      </div>

      {(instance.status === "running" || instance.status === "stopped") && (
        <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] tracking-[0.1em] uppercase">
            Access
          </CardDescription>
        </CardHeader>
        <CardContent>
          {access ? (
            <>
              <a
                href={access.url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-mono text-sm text-foreground hover:text-primary"
              >
                {access.url}
              </a>
              {access.scheme === "http" && instance.domain && (
                <p className="mt-2 font-mono text-xs text-amber-500">
                  TLS certificate pending — accessed over HTTP until Let&apos;s Encrypt completes.
                </p>
              )}
              {access.scheme === "http" && !instance.domain && !instance.managedSubdomain && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Raw IP access over HTTP. A managed hostname or custom domain enables HTTPS.
                </p>
              )}
              {access.scheme === "https" && instance.domain && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {instance.tlsStatus === "issued"
                    ? "Served with Let's Encrypt certificate."
                    : "TLS certificate pending — check DNS for your custom domain."}
                </p>
              )}
              {access.scheme === "https" && instance.managedSubdomain && !instance.domain && (
                <p className="mt-2 text-xs text-muted-foreground">
                  HTTPS via Cloudflare to your agent hostname. Direct IP access may use HTTP on port 80.
                </p>
              )}
            </>
          ) : (
            <p className="font-mono text-sm text-muted-foreground">
              Provisioning… no public access yet.
            </p>
          )}
        </CardContent>
        </Card>
      )}

      <InstanceTabs
        active={tab || "overview"}
        access={accessControl}
        instance={{
          id: instance.id,
          name: instance.name,
          status: instance.status,
          ipAddress: instance.ipAddress,
          serverLabel: instance.serverConfig.label,
          vcpu: instance.serverConfig.vcpu,
          ramGb: instance.serverConfig.ramGb,
          createdAt: instance.createdAt.toISOString(),
          domain: instance.domain,
          managedSubdomain: instance.managedSubdomain,
          dnsStatus: instance.dnsStatus,
          tlsStatus: instance.tlsStatus,
          domainProxied: Boolean(instance.domainProxied),
          cfZoneId: instance.cfZoneId ?? null,
          openclawAdminEmail: instance.openclawAdminEmail,
          hasOpenclawPassword: Boolean(instance.openclawAdminPasswordEnc),
          hasRootPassword: Boolean(instance.rootPasswordEnc),
          hasGatewayToken: Boolean(instance.gatewayTokenEnc),
          deploymentTarget: instance.deploymentTarget,
          provisionStage: instance.provisionStage ?? null,
          agentType: instance.agentType ?? null,
          runtime: instance.runtime ?? null,
          runtimeLabel: getRuntime(instance.runtime).displayName,
          webuiEnabled: Boolean(instance.webuiEnabled),
          byosHost: instance.byosHost ?? null,
          byosPort: instance.byosPort ?? null,
          byosUser: instance.byosUser ?? null,
          byosLlmMode: instance.byosLlmMode ?? null,
          costUsd: instance.openRouterUsageUsd ?? 0,
          lastEventAt: instance.lastEventAt ? instance.lastEventAt.toISOString() : null,
        }}
        logs={instance.logs.map((l) => ({
          id: l.id,
          level: l.level,
          message: l.message,
          createdAt: l.createdAt.toISOString(),
        }))}
        drive={{
          configured: isDriveConfigured(),
          connected: Boolean(driveConn),
          email: driveConn?.googleEmail ?? null,
        }}
        cloudflare={{
          connected: Boolean(cloudflareConn),
        }}
        kuma={{
          configured: isKumaConfigured(),
          status: instance.kumaStatus,
          responseTimeMs: instance.kumaResponseTimeMs,
          uptimeRatio: instance.kumaUptimeRatio,
          certDaysRemaining: instance.kumaCertDaysRemaining,
          checkedAt: instance.kumaCheckedAt ? instance.kumaCheckedAt.toISOString() : null,
        }}
        backups={backupRows.map((b) => ({
          id: b.id,
          fileName: b.fileName,
          agentName: b.agentName,
          sizeBytes: b.sizeBytes,
          createdAt: b.createdAt.toISOString(),
        }))}
      />
    </PageContainer>
  )
}
