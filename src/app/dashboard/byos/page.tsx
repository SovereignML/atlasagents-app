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
import { db, instances, inArray } from "@/db"
import {
  findLegacyServerPlans,
  isFreePlan,
  listByosPlans,
  serverLabels,
} from "@/lib/byos-plan"
import { planAllowsInstall } from "@/lib/byos-install"
import { recoverByosPlanCheckouts } from "@/lib/checkout-recovery"
import { BYOS_PLAN, formatUsd } from "@/configs/plans"
import { BuyPlanButton } from "./buy-plan-button"
import { PlanList, type PlanRowData } from "./plan-list"
import { ServerCard, type ServerCardData } from "./server-card"

const PLAN_FEATURES = [
  "Connecting servers is free — no plan needed",
  "One plan runs one agent, on any of your servers",
  "Buy plans ahead, or at install",
  "Cancel any time; it runs to the end of the period",
  "Live specs and health monitoring",
  "Managed updates & backups",
  "Bring your own LLM key, or use credits",
  "No vendor lock-in",
]

export default async function ByosPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>
}) {
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
  const legacyPlans = await findLegacyServerPlans(servers.map((s) => s.id))

  // Back from buying a plan: if the webhook hasn't recorded it yet, ask Stripe
  // so the new plan shows up now.
  if (ctx && (await searchParams).plan === "bought") {
    await recoverByosPlanCheckouts(ctx.effectiveUserId)
  }
  const plans = ctx ? await listByosPlans(ctx.effectiveUserId) : []
  const freeCount = plans.filter(isFreePlan).length
  const inUseCount = plans.length - freeCount
  const agentIds = plans.flatMap((p) => (p.instanceId ? [p.instanceId] : []))
  const agents = agentIds.length
    ? await db
        .select({ id: instances.id, name: instances.name })
        .from(instances)
        .where(inArray(instances.id, agentIds))
    : []
  const agentById = new Map(agents.map((a) => [a.id, a]))
  const labels = await serverLabels(
    plans.flatMap((p) => (p.byosServerId ? [p.byosServerId] : [])),
  )
  const planRows: PlanRowData[] = plans.map((p) => ({
    subscriptionId: p.subscriptionId,
    interval: p.interval,
    currentPeriodEnd: p.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: p.cancelAtPeriodEnd,
    allowsInstall: planAllowsInstall(p.status),
    agent: p.instanceId ? (agentById.get(p.instanceId) ?? null) : null,
    serverLabel: p.byosServerId ? (labels.get(p.byosServerId) ?? "a disconnected server") : null,
  }))

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
    legacyPlan: (() => {
      const p = legacyPlans.get(s.id)
      return p
        ? {
            allowsInstall: planAllowsInstall(p.status),
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
        description="Run managed agents on hardware you own. Connecting a server is free; each agent you install needs a BYOS plan."
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
                <ServerCard key={s.id} server={s} />
              ))}
            </div>
          )}

          <section className="space-y-[18px] pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">BYOS plans</h2>
                <p className="text-sm text-muted-foreground">
                  {plans.length === 0
                    ? "No plans yet. Buy one now, or install an agent and pay for its plan then."
                    : `${plans.length} ${plans.length === 1 ? "plan" : "plans"} · ${inUseCount} in use · ${freeCount} free`}
                </p>
              </div>
              <BuyPlanButton
                priceMonthly={BYOS_PLAN.displayPriceMonthly}
                priceYearly={BYOS_PLAN.displayPriceYearly}
              />
            </div>
            {planRows.length > 0 && <PlanList plans={planRows} />}
          </section>
        </div>

        <aside className="rounded-2xl border border-border bg-card p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Bring your own server
          </p>
          <p className="mt-2 text-3xl font-semibold text-foreground">
            {formatUsd(BYOS_PLAN.displayPriceMonthly)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">/mo per agent</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Or {formatUsd(BYOS_PLAN.displayPriceYearly)}/yr. One plan per agent, on whichever of
            your servers you like. Connected servers cost nothing.
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
