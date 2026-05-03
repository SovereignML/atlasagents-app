import { Suspense } from "react"
import { LoginForm } from "@/components/auth/login-form"
import { LoginBanners } from "@/components/auth/login-banners"
import { isGoogleOAuthConfigured } from "@/lib/google-oauth"

export default function LoginPage() {
  return (
    <>
      <Suspense fallback={null}>
        <LoginBanners />
      </Suspense>
      <LoginForm showGoogleOAuth={isGoogleOAuthConfigured()} />
    </>
  )
}
