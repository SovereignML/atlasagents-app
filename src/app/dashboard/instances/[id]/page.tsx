import { auth } from "@/auth"
import { db } from "@/db"
import { notFound, redirect } from "next/navigation"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { InstanceTabs } from "./instance-tabs"
import { buildPublicGatewayUrl } from "@/lib/instance-gateway-access"

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  running: "bg-[var(--accent-dim)] text-[var(--accent-color)] border-[var(--accent-color)]/30",
  provisioning: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  stopped: "bg-[var(--card-bg)] text-[var(--text-secondary)] border-[var(--border-color)]",
  failed_provisioning: "bg-red-500/10 text-red-400 border-red-500/30",
  deleting: "bg-zinc-800/20 text-zinc-400 border-zinc-800/30",
  deleted: "bg-[var(--card-bg)] text-[var(--text-secondary)]/50 border-[var(--border-color)]",
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

  const access = buildPublicGatewayUrl({
    ipAddress: instance.ipAddress,
    domain: instance.domain,
    managedSubdomain: instance.managedSubdomain,
    tlsStatus: instance.tlsStatus,
  })

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/dashboard/instances"
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent-color)] font-mono"
          >
            ← Back to agents
          </Link>
          <div className="flex items-center gap-3 mt-2">
            <h1
              className="text-3xl font-bold uppercase tracking-[0.02em] text-[var(--text-primary)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {instance.name}
            </h1>
            <Badge className={STATUS_STYLES[instance.status] || STATUS_STYLES.stopped}>
              {instance.status}
            </Badge>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-1 font-mono">
            {instance.slug}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
        <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-[0.1em] font-mono mb-2">
          Access
        </p>
        {access ? (
          <>
            <a
              href={access.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sm text-[var(--text-primary)] hover:text-[var(--accent-color)] break-all"
            >
              {access.url}
            </a>
            {access.scheme === "http" && instance.domain && (
              <p className="text-xs text-amber-400 mt-2 font-mono">
                TLS certificate pending — accessed over HTTP until Let&apos;s Encrypt completes.
              </p>
            )}
            {access.scheme === "http" && !instance.domain && !instance.managedSubdomain && (
              <p className="text-xs text-[var(--text-secondary)] mt-2">
                Raw IP access over HTTP. A managed hostname or custom domain enables HTTPS.
              </p>
            )}
            {access.scheme === "https" && instance.domain && (
              <p className="text-xs text-[var(--text-secondary)] mt-2">
                {instance.tlsStatus === "issued"
                  ? "Served with Let&apos;s Encrypt certificate."
                  : "TLS certificate pending — check DNS for your custom domain."}
              </p>
            )}
            {access.scheme === "https" && instance.managedSubdomain && !instance.domain && (
              <p className="text-xs text-[var(--text-secondary)] mt-2">
                HTTPS via Cloudflare to your agent hostname. Direct IP access may use HTTP on port 80.
              </p>
            )}
          </>
        ) : (
          <p className="font-mono text-sm text-[var(--text-secondary)]">
            Provisioning… no public access yet.
          </p>
        )}
      </div>

      <InstanceTabs
        active={tab || "overview"}
        instance={{
          id: instance.id,
          name: instance.name,
          status: instance.status,
          ipAddress: instance.ipAddress,
          regionLabel: `${instance.region.flag} ${instance.region.name}`,
          serverLabel: instance.serverConfig.label,
          vcpu: instance.serverConfig.vcpu,
          ramGb: instance.serverConfig.ramGb,
          createdAt: instance.createdAt.toISOString(),
          domain: instance.domain,
          managedSubdomain: instance.managedSubdomain,
          dnsStatus: instance.dnsStatus,
          tlsStatus: instance.tlsStatus,
          openclawAdminEmail: instance.openclawAdminEmail,
          hasOpenclawPassword: Boolean(instance.openclawAdminPasswordEnc),
          hasRootPassword: Boolean(instance.rootPasswordEnc),
          hasGatewayToken: Boolean(instance.gatewayTokenEnc),
          deploymentTarget: instance.deploymentTarget,
          provisionStage: instance.provisionStage ?? null,
          agentType: instance.agentType ?? null,
        }}
        logs={instance.logs.map((l) => ({
          id: l.id,
          level: l.level,
          message: l.message,
          createdAt: l.createdAt.toISOString(),
        }))}
      />
    </div>
  )
}
