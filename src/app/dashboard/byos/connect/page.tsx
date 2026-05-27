import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { normalizePem } from "@/lib/ssh"
import { BYOS_PLAN } from "@/configs/plans"
import { ByosConnectForm } from "./connect-form"

export default async function ByosConnectPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  // The fleet public key is safe to surface — it's public key material the
  // user must paste into their own server's authorized_keys.
  const raw = process.env.SSH_FLEET_PUBLIC_KEY
  const fleetPublicKey = raw ? normalizePem(raw).trim() : null

  return (
    <PageContainer>
      <PageHeader
        title="Connect your server"
        description="Bring your own server — we install, run, and manage the agent on it for a flat fee."
      />
      <ByosConnectForm
        fleetPublicKey={fleetPublicKey}
        priceMonthly={BYOS_PLAN.displayPriceMonthly}
        priceYearly={BYOS_PLAN.displayPriceYearly}
      />
    </PageContainer>
  )
}
