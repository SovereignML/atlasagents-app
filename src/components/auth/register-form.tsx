"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useState } from "react"
import { CircleAlert } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OAuthButtons, type OAuthAvailability } from "@/components/auth/oauth-buttons"
import { TurnstileWidget } from "@/components/auth/turnstile-widget"

const turnstileEnabled = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

export interface RegisterFormProps {
  showGoogleOAuth?: boolean
  providers?: OAuthAvailability
}

export function RegisterForm({ showGoogleOAuth = false, providers }: RegisterFormProps) {
  const router = useRouter()
  const resolvedProviders: OAuthAvailability = providers ?? {
    google: showGoogleOAuth,
    twitter: false,
    apple: false,
  }

  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState("")
  const [agreed, setAgreed] = useState(false)

  const onTurnstileVerify = useCallback((token: string) => setTurnstileToken(token), [])
  const onTurnstileExpire = useCallback(() => setTurnstileToken(""), [])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!agreed) {
      setError("Please agree to the Privacy Policy, Terms of Service, and Refund Policy to continue.")
      return
    }

    setLoading(true)
    setError("")

    const formData = new FormData(e.currentTarget)
    const name = formData.get("name") as string
    const email = formData.get("email") as string
    const password = formData.get("password") as string

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, turnstileToken }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || "Something went wrong")
      setLoading(false)
      return
    }

    router.push("/login?registered=true")
  }

  const hasOAuth =
    resolvedProviders.google || resolvedProviders.twitter || resolvedProviders.apple

  return (
    <Card className="w-full">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">Create Account</CardTitle>
        <CardDescription>Deploy and manage your AI agents in minutes</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {hasOAuth && (
            <>
              <OAuthButtons providers={resolvedProviders} />
              <FieldSeparator>or</FieldSeparator>
            </>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive" className="flex items-center justify-center gap-2 text-center">
                <CircleAlert className="shrink-0" />
                <AlertDescription className="text-center">{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input
                id="name"
                name="name"
                type="text"
                placeholder="John Doe"
                required
                minLength={2}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
                minLength={6}
              />
            </Field>
            <TurnstileWidget
              onVerify={onTurnstileVerify}
              onExpire={onTurnstileExpire}
            />
            <Field>
              <label className="flex items-start gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  name="agree"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 rounded border-border accent-primary"
                  required
                />
                <span>
                  I agree to the{" "}
                  <Link href="/privacy" target="_blank" className="text-primary hover:underline">
                    Privacy Policy
                  </Link>
                  ,{" "}
                  <Link href="/terms" target="_blank" className="text-primary hover:underline">
                    Terms of Service
                  </Link>
                  , and{" "}
                  <Link href="/refund" target="_blank" className="text-primary hover:underline">
                    Refund Policy
                  </Link>
                  .
                </span>
              </label>
            </Field>
            <Button
              type="submit"
              variant="gradient"
              size="pill"
              className="w-full"
              disabled={loading || !agreed || (turnstileEnabled && !turnstileToken)}
            >
              {loading ? "Creating account..." : "Create Account"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
