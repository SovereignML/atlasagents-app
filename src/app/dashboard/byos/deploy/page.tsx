import Link from "next/link"
import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { db, byosServers, and, eq } from "@/db"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { getEffectiveTeam } from "@/lib/effective-user"
import { BYOS_PLAN, formatUsd } from "@/configs/plans"
import { findByosPlan } from "@/lib/byos-plan"
import { planBlockedReason } from "@/lib/byos-install"
import { recoverByosPlanCheckout } from "@/lib/checkout-recovery"
import { Button } from "@/components/ui/button"
import { BuyPlanButton } from "../buy-plan-button"
import { ByosInstallForm, type InstallServer } from "./install-form"

/**
 * Install an agent onto a server the customer has already connected.
 *
 * The server is chosen on /dashboard/byos, not here — this page will not open
 * without one. It used to ask for the host, SSH port, user and the
 * authorized_keys command all over again, which was the connect flow duplicated
 * inside the paid flow: the customer re-entered a machine we were already
 * talking to, and the agent came out unlinked from it.
 */
export default async function ByosDeployPage({
  searchParams,
}: {
  searchParams: Promise<{ serverId?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const { serverId } = await searchParams
  // No server picked: send them to the list, which is where servers are chosen
  // and connected. Landing on an install form with nothing to install onto is
  // the dead end this page used to paper over with a second connect form.
  if (!serverId) redirect("/dashboard/byos")

  // Resolve through impersonation so an admin viewing-as a user sees the same
  // servers the list page showed them — and, critically, the same team
  // /api/byos/deploy will install into.
  const ctx = await getEffectiveTeam()
  if (!ctx) redirect("/dashboard/byos")

  // Team-scoped: a serverId from another team must not resolve.
  const server = await db.query.byosServers.findFirst({
    where: and(eq(byosServers.id, serverId), eq(byosServers.teamId, ctx.teamId)),
  })
  if (!server) redirect("/dashboard/byos")

  // Installing needs a BYOS plan for this server. This page is the plan
  // checkout's success_url, so if none is recorded yet, ask Stripe before
  // concluding there isn't one — the webhook may not have landed.
  let plan = await findByosPlan(server.id)
  if (!plan && (await recoverByosPlanCheckout(server.id, ctx.effectiveUserId))) {
    plan = await findByosPlan(server.id)
  }
  const planBlocked = planBlockedReason(plan)

  const installServer: InstallServer = {
    id: server.id,
    label: server.label,
    host: server.host,
    port: server.port,
    sshUser: server.sshUser,
    status: server.status,
    hwCpuCores: server.hwCpuCores,
    hwRamTotalMb: server.hwRamTotalMb,
    hwDiskTotalGb: server.hwDiskTotalGb,
    hwOsName: server.hwOsName,
    hwOsVersion: server.hwOsVersion,
    capacityAgents: server.capacityAgents,
  }

  return (
    <PageContainer>
      <PageHeader
        title="Install an agent"
        description={`Onto ${server.label}, a server you own. Its BYOS plan (${formatUsd(
          BYOS_PLAN.displayPriceMonthly,
        )}/mo) covers every agent you install on it — no compute charges.`}
      />
      {planBlocked ? (
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="font-medium text-foreground">{planBlocked}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            One plan covers as many agents as {server.label} can hold. Connecting stays free.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {plan ? (
              <Button
                size="sm"
                variant="gradient"
                render={<Link href="/dashboard/billing">Go to Billing</Link>}
              />
            ) : (
              <BuyPlanButton
                serverId={server.id}
                priceMonthly={BYOS_PLAN.displayPriceMonthly}
                priceYearly={BYOS_PLAN.displayPriceYearly}
              />
            )}
            <Button
              size="sm"
              variant="ghost"
              render={<Link href="/dashboard/byos">Back to servers</Link>}
            />
          </div>
        </div>
      ) : (
        <ByosInstallForm server={installServer} />
      )}
    </PageContainer>
  )
}
