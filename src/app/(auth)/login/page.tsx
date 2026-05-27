import { Suspense } from "react"
import { headers } from "next/headers"

import { LoginForm } from "@/components/auth/login-form"
import { LoginBanners } from "@/components/auth/login-banners"
import { getConfiguredOAuthProviders } from "@/lib/oauth"
import { normalizeHost, isCanonicalHost } from "@/lib/host"

export const dynamic = "force-dynamic"

export default async function LoginPage() {
  // OAuth callback URLs can only be pre-registered for the canonical host, so
  // on a white-label custom domain we offer email/password login only.
  const h = await headers()
  const host = normalizeHost(h.get("x-forwarded-host") ?? h.get("host"))
  const onCustomDomain = host != null && !isCanonicalHost(host)

  const providers = onCustomDomain
    ? { google: false, twitter: false, apple: false }
    : getConfiguredOAuthProviders()

  return (
    <>
      <Suspense fallback={null}>
        <LoginBanners />
      </Suspense>
      <LoginForm providers={providers} />
    </>
  )
}
