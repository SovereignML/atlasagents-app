import Link from "next/link"
import { redirect } from "next/navigation"

import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { getTenantConfig } from "@/lib/tenant"
import { PageContainer, PageHeader, PageSection } from "@/components/layout/page-container"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChatwootClient, type ChatwootState } from "./chatwoot-client"
import { ResellerOpsClient, type ResellerOpsState } from "./reseller-ops-client"

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

  return (
    <PageContainer>
      <PageHeader
        title="Branding & Settings"
        description="Customize your white-label look and connect your own support stack."
      />

      <PageSection title="Branding & custom domain">
        <Card size="sm">
          <CardHeader>
            <CardTitle>White-label branding</CardTitle>
            <CardDescription>
              Logos, colors, and your custom dashboard domain are managed in the Team Branding tab.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" render={<Link href="/dashboard/team?tab=branding">Open branding settings</Link>} />
          </CardContent>
        </Card>
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
    </PageContainer>
  )
}
