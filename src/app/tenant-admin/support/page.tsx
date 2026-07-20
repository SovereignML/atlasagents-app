import { redirect } from "next/navigation"

import { requireTenantAdmin, isTenantGuardError } from "@/lib/tenant-admin-access"
import { resolveChatwootForTeam } from "@/lib/chatwoot"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { SupportInboxClient } from "./support-client"

export const dynamic = "force-dynamic"

export default async function TenantSupportPage() {
  const admin = await requireTenantAdmin()
  if (isTenantGuardError(admin)) redirect("/dashboard")

  const cfg = await resolveChatwootForTeam(admin.tenantTeamId)

  return (
    <PageContainer>
      <PageHeader
        title="Support Inbox"
        description="Your end-customers' conversations, answered from your own Chatwoot."
      />
      {cfg ? (
        <SupportInboxClient />
      ) : (
        <Alert>
          <AlertDescription>
            Connect your Chatwoot in Branding &amp; Settings to use the support inbox.
          </AlertDescription>
        </Alert>
      )}
    </PageContainer>
  )
}
