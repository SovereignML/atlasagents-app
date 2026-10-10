import Link from "next/link"
import { redirect } from "next/navigation"
import { Plus, Server } from "lucide-react"

import { auth } from "@/auth"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { getEffectiveTeam } from "@/lib/effective-user"
import { listServersForTeam, MAX_IDLE_SERVERS_PER_TEAM } from "@/lib/byos-server"
import { findByosPlans } from "@/lib/byos-plan"
import { planAllowsInstall } from "@/lib/byos-install"
import { BYOS_PLAN, formatUsd } from "@/configs/plans"
import { ServerCard, type ServerCardData } from "./server-card"

const PLAN_FEATURES = [
  "Connecting a server is free",
  "One plan covers every agent on its server",
  "Live specs and health monitoring",
  "Managed updates & backups",
  "Bring your own LLM key, or use credits",
  "No vendor lock-in",
]

export default async function ByosPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  // Resolve through impersonation so an admin viewing-as a user sees their
  // servers. getEffectiveTeam (not getUserTeam(effectiveUserId)) because under
  // "act as customer" the team is PINNED to the child team in the cookie, which
  // is not necessarily that owner's mutable activeTeamId — and this page must
  // resolve the same team the connect/install routes write to.
  const ctx = await getEffectiveTeam()

  const servers = ctx ? await listServersForTeam(ctx.teamId) : []
  const idleUsed = servers.filter((s) => s.agentCount === 0).length
  const plans = await findByosPlans(servers.map((s) => s.id))

  const cards: ServerCardData[] = servers.map((s) => ({
    id: s.id,
    label: s.label,
    host: s.host,
    port: s.port,
    sshUser: s.sshUser,
    status: s.status,
    lastError: s.lastError,
    lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
    hwCpuCores: s.hwCpuCores,
    hwRamTotalMb: s.hwRamTotalMb,
    hwDiskTotalGb: s.hwDiskTotalGb,
    hwDiskUsedGb: s.hwDiskUsedGb,
    hwOsName: s.hwOsName,
    hwOsVersion: s.hwOsVersion,
    hwKernel: s.hwKernel,
    capacityAgents: s.capacityAgents,
    agentCount: s.agentCount,
    plan: (() => {
      const p = plans.get(s.id)
      return p
        ? {
            status: p.status,
            allowsInstall: planAllowsInstall(p.status),
            interval: p.interval,
            currentPeriodEnd: p.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: p.cancelAtPeriodEnd,
          }
        : null
    })(),
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Your servers"
        description="Run managed agents on hardware you own. Connecting a server is free — buy a BYOS plan for a server to install agents on it."
      />

      <div className="grid grid-cols-1 items-start gap-[18px] lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-[18px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {servers.length === 0
                ? "No servers connected yet."
                : `${servers.length} connected · ${idleUsed}/${MAX_IDLE_SERVERS_PER_TEAM} without an agent`}
            </p>
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
          </div>

          {cards.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Server />
                </EmptyMedia>
                <EmptyTitle>No connected servers yet</EmptyTitle>
                <EmptyDescription>
                  Add our SSH key to a server you own and we&apos;ll check it over and show you
                  exactly what it can run. It costs nothing, and nothing is installed until you
                  choose an agent.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-[18px]">
              {cards.map((s) => (
                <ServerCard
                  key={s.id}
                  server={s}
                  priceMonthly={BYOS_PLAN.displayPriceMonthly}
                  priceYearly={BYOS_PLAN.displayPriceYearly}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="rounded-2xl border border-border bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Bring your own server
          </p>
          <p className="mt-2 text-3xl font-semibold text-foreground">
            {formatUsd(BYOS_PLAN.displayPriceMonthly)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">/mo per server</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Or {formatUsd(BYOS_PLAN.displayPriceYearly)}/yr. Buy it for the servers you want to
            run agents on; connected servers without a plan cost nothing.
          </p>
          <ul className="mt-5 space-y-2 border-t border-border pt-5 text-sm text-muted-foreground">
            {PLAN_FEATURES.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </aside>
      </div>
    </PageContainer>
  )
}
