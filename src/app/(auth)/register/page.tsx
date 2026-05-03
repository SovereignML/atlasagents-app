import { RegisterForm } from "@/components/auth/register-form"
import { isGoogleOAuthConfigured } from "@/lib/google-oauth"

export default function RegisterPage() {
  return <RegisterForm showGoogleOAuth={isGoogleOAuthConfigured()} />
}
