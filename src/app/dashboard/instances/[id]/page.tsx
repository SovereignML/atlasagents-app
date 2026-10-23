import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { auth } from "@/auth"
import {
  db,
  eq,
  desc,
  driveConnections,
  cloudflareConnections,
  backupRecords,
  instanceUptimeSamples,
} from "@/db"
import { isDriveConfigured } from "@/lib/google-drive"
import { isKumaConfigured } from "@/lib/uptime-kuma"
import { maybeRunUptimeSync } from "@/lib/uptime-monitoring"
import { maybeReapDemoInstances } from "@/lib/demo-reaper"
import { recoverPaidCheckout } from "@/lib/checkout-recovery"
import { Badge } from "@/components/ui/badge"
import { DemoCountdown } from "@/components/instances/demo-countdown"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { PageContainer } from "@/components/layout/page-container"
import { RuntimeLogo } from "@/components/dashboard/runtime-logo"
import { buildPublicGatewayUrl } from "@/lib/instance-gateway-access"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { getEffectiveUserId } from "@/lib/effective-user"
import { getInstanceAccessLevel, levelAtLeast } from "@/lib/instance-access"
import { getRuntime } from "@/lib/runtimes"
import { AgentName } from "./agent-name"
import { AgentAccessCard } from "./agent-access-card"
import { chatAgentFor, hasDashboardChat } from "@/lib/chat-windows"
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
  // Resolve through impersonation so an admin viewing-as a user can open their agents.
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
  const isPlatformAdmin = (session.user as { role?: string }).role === "admin"

  const { id } = await params
  const { tab } = await searchParams

  // Best-effort: freshen the Kuma snapshot/history before we read it (no-op when
  // Kuma is unconfigured or synced recently). Never throws.
  await maybeRunUptimeSync()
  // Best-effort: tear down any Free demos past their 30-min trial so a viewer
  // watching the dashboard reaps them without an external cron (throttled ~60s).
  void maybeReapDemoInstances().catch(() => {})

  const instance = await db.query.instances.findFirst({
    where: whereUserInstanceVisible(effectiveUserId, id),
    with: {
      region: true,
      serverConfig: true,
      logs: {
        orderBy: (logs, { desc }) => desc(logs.createdAt),
        limit: 100,
      },
    },
  })

  if (!instance) notFound()

  // Paid deploy still `pending`: ask Stripe directly in case the webhook never
  // arrived (this is the Checkout success_url, so it runs on the customer's
  // return). Background + throttled; never throws. See checkout-recovery.ts.
  if (instance.status === "pending") void recoverPaidCheckout(instance.id)

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

  // Most recent Kuma heartbeat samples for this agent (oldest→newest for the bar
  // strip). Cheap, indexed read; empty until the first sync writes one. Best-effort
  // — the bars are an enhancement, so a missing table / error must not 500 the page.
  let uptimeSamples: { status: string | null; responseTimeMs: number | null; checkedAt: string }[] = []
  try {
    const uptimeSampleRows = await db.query.instanceUptimeSamples.findMany({
      where: eq(instanceUptimeSamples.instanceId, instance.id),
      orderBy: desc(instanceUptimeSamples.checkedAt),
      limit: 50,
      columns: { status: true, responseTimeMs: true, checkedAt: true },
    })
    uptimeSamples = uptimeSampleRows
      .map((s) => ({
        status: s.status,
        responseTimeMs: s.responseTimeMs,
        checkedAt: s.checkedAt.toISOString(),
      }))
      .reverse()
  } catch {
    /* heartbeat history unavailable — render without bars */
  }

  // The viewer's effective access level drives which controls/tabs render.
  const myAccess = await getInstanceAccessLevel(effectiveUserId, instance.id)
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
            <AgentName
              instanceId={instance.id}
              name={instance.name}
              canRename={instance.status !== "deleted" && (isPlatformAdmin || accessControl.canManageAccess)}
            />
            {instance.status === "running" ? (
              <Badge
                variant="default"
                className="inline-flex items-center gap-1.5 px-3 py-1 text-[13px]"
              >
                <span className="size-1.5 rounded-full bg-primary-foreground" />
                {instance.status}
              </Badge>
            ) : (
              <Badge variant={statusBadgeVariant(instance.status)}>{instance.status}</Badge>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1">
              <RuntimeLogo runtime={instance.runtime} size={13} className="size-[13px]" />
              <span className="font-mono text-xs text-muted-foreground">
                {getRuntime(instance.runtime).displayName}
              </span>
            </span>
            {instance.expiresAt && instance.status !== "deleted" && (
              <DemoCountdown expiresAt={instance.expiresAt.toISOString()} />
            )}
          </div>
          <p className="font-mono text-xs text-muted-foreground">{instance.slug}</p>
        </div>
      </div>

      {(instance.status === "running" || instance.status === "stopped") && (
        <AgentAccessCard
          agent={chatAgentFor(instance)}
          dashboardChat={hasDashboardChat(instance)}
          canChat={isPlatformAdmin || accessControl.canOperate}
          hostname={
            access && (instance.domain || instance.managedSubdomain)
              ? { url: access.url, kind: instance.domain ? "domain" : "managed" }
              : null
          }
          ipAddress={instance.ipAddress}
          hostnameNote={
            !access
              ? null
              : instance.domain
                ? access.scheme === "http"
                  ? "TLS certificate pending. Served over HTTP until Let's Encrypt completes."
                  : instance.tlsStatus === "issued"
                    ? "Served with a Let's Encrypt certificate."
                    : "TLS certificate pending. Check DNS for your custom domain."
                : "HTTPS via Cloudflare."
          }
        />
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
          customInstructions:
            (instance.agentConfig as { custom_instructions?: string } | null)
              ?.custom_instructions ?? "",
          runtime: instance.runtime ?? null,
          runtimeLabel: getRuntime(instance.runtime).displayName,
          webuiEnabled: Boolean(instance.webuiEnabled),
          chatUi: instance.chatUi ?? null,
          byosHost: instance.byosHost ?? null,
          byosPort: instance.byosPort ?? null,
          byosUser: instance.byosUser ?? null,
          byosLlmMode: instance.byosLlmMode ?? null,
          costUsd: instance.openRouterUsageUsd ?? 0,
          lastEventAt: instance.lastEventAt ? instance.lastEventAt.toISOString() : null,
          hwCpuCores: instance.hwCpuCores ?? null,
          hwCpuLoad1: instance.hwCpuLoad1 ?? null,
          hwRamTotalMb: instance.hwRamTotalMb ?? null,
          hwRamUsedMb: instance.hwRamUsedMb ?? null,
          hwDiskTotalGb: instance.hwDiskTotalGb ?? null,
          hwDiskUsedGb: instance.hwDiskUsedGb ?? null,
          hwOsName: instance.hwOsName ?? null,
          hwOsVersion: instance.hwOsVersion ?? null,
          hwKernel: instance.hwKernel ?? null,
          hwUptimeSec: instance.hwUptimeSec ?? null,
          hwHealth: instance.hwHealth ?? null,
          hwCheckedAt: instance.hwCheckedAt ? instance.hwCheckedAt.toISOString() : null,
          hwError: instance.hwError ?? null,
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
          samples: uptimeSamples,
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
