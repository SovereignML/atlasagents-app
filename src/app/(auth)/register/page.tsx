import { headers } from "next/headers"

import { RegisterForm } from "@/components/auth/register-form"
import { getConfiguredOAuthProviders } from "@/lib/oauth"
import { normalizeHost, isCanonicalHost } from "@/lib/host"

export const dynamic = "force-dynamic"

export default async function RegisterPage() {
  // OAuth callbacks can't be pre-registered for arbitrary custom domains, so
  // white-label custom domains offer email/password only (see login page).
  const h = await headers()
  const host = normalizeHost(h.get("x-forwarded-host") ?? h.get("host"))
  const onCustomDomain = host != null && !isCanonicalHost(host)

  const providers = onCustomDomain
    ? { google: false, twitter: false, apple: false }
    : getConfiguredOAuthProviders()

  return <RegisterForm providers={providers} />
}
