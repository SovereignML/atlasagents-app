import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { normalizePem } from "@/lib/ssh"
import { ConnectServerForm } from "./connect-server-form"

/**
 * Connect a server you already own — free, and separate from installing an
 * agent on it. This page only establishes access and reads the machine; the
 * agent (and the charge) comes afterwards from the server's card.
 */
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
        title="Connect a server"
        description="Point us at a server you own. We'll check it and show you what it can run — free, and nothing is installed until you add an agent."
      />
      <ConnectServerForm fleetPublicKey={fleetPublicKey} />
    </PageContainer>
  )
}
