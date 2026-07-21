import { redirect } from "next/navigation"

import { db, eq, desc, tenantPlans, teamBranding } from "@/db"
import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { getTenantConfig } from "@/lib/tenant"
import { PageContainer, PageHeader, PageSection } from "@/components/layout/page-container"
import {
  BrandingClient,
  type BrandingState,
} from "@/app/dashboard/settings/branding/branding-client"
import { ChatwootClient, type ChatwootState } from "./chatwoot-client"
import { ResellerOpsClient, type ResellerOpsState } from "./reseller-ops-client"
import { PlansClient, type TenantPlan } from "./plans-client"

export const dynamic = "force-dynamic"

export default async function TenantSettingsPage() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) redirect("/dashboard")

  const cfg = await getTenantConfig(admin.tenantTeamId)
  const initial: ChatwootState = {
    baseUrl: cfg?.chatwootBaseUrl ?? "",
    accountId: cfg?.chatwootAccountId ?? "",
    inboxId: cfg?.chatwootInboxId ?? "",
    websiteToken: cfg?.chatwootWebsiteToken ?? "",
    hasApiToken: Boolean(cfg?.chatwootApiTokenEnc),
    hasHmacToken: Boolean(cfg?.chatwootHmacTokenEnc),
  }

  const ops: ResellerOpsState = {
    connectAccountId: cfg?.stripeConnectAccountId ?? null,
    chargesEnabled: cfg?.stripeConnectChargesEnabled ?? false,
    payoutsEnabled: cfg?.stripeConnectPayoutsEnabled ?? false,
    hasOpenRouterKey: Boolean(cfg?.openRouterProvisioningKeyEnc),
  }

  // White-label branding for this tenant team (logos, colors, custom domain).
  // Mirrors the mapping that used to live on the team page's Branding tab.
  const brandingRow = await db.query.teamBranding.findFirst({
    where: eq(teamBranding.teamId, admin.tenantTeamId),
  })
  const branding: BrandingState = {
    brandName: brandingRow?.brandName ?? "",
    supportEmail: brandingRow?.supportEmail ?? "",
    logoUrl: brandingRow?.logoUrl ?? "",
    logoMarkUrl: brandingRow?.logoMarkUrl ?? "",
    faviconUrl: brandingRow?.faviconUrl ?? "",
    primaryLight: brandingRow?.primaryLight ?? "",
    accentLight: brandingRow?.accentLight ?? "",
    primaryDark: brandingRow?.primaryDark ?? "",
    accentDark: brandingRow?.accentDark ?? "",
    brandingEnabled: brandingRow?.brandingEnabled ?? true,
  }

  const planRows = await db.query.tenantPlans.findMany({
    where: eq(tenantPlans.teamId, admin.tenantTeamId),
    orderBy: desc(tenantPlans.createdAt),
  })
  const plans: TenantPlan[] = planRows.map((p) => ({
    id: p.id,
    name: p.name,
    priceCents: p.priceCents,
    interval: p.interval,
    agentLimit: p.agentLimit,
    seatLimit: p.seatLimit,
    active: p.active,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Branding & Settings"
        description="Customize your white-label look and connect your own support stack."
      />

      <PageSection
        title="Branding & custom domain"
        description="Logos, colors, and your custom dashboard domain — the white-label look your customers see."
      >
        <BrandingClient initial={branding} />
      </PageSection>

      <PageSection
        title="Support (Chatwoot)"
        description="Connect your own Chatwoot so your customers' support tickets and live chat go to YOUR inbox, not ours."
      >
        <ChatwootClient initial={initial} />
      </PageSection>

      <PageSection
        title="Billing & LLM"
        description="Collect payments from your customers on your own Stripe, and run their agents on your own OpenRouter account."
      >
        <ResellerOpsClient initial={ops} />
      </PageSection>

      <PageSection
        title="Plans"
        description="Define the plans your customers can subscribe to. Each creates a price on your own Stripe; on subscribe, the plan's caps apply to that customer."
      >
        <PlansClient plans={plans} connected={Boolean(cfg?.stripeConnectAccountId)} />
      </PageSection>
    </PageContainer>
  )
}
