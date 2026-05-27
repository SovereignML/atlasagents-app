"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { signIn } from "next-auth/react"

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

export interface LoginFormProps {
  /** Backwards-compatible flag — also enables Google if true. */
  showGoogleOAuth?: boolean
  providers?: OAuthAvailability
}

export function LoginForm({ showGoogleOAuth = false, providers }: LoginFormProps) {
  const router = useRouter()
  const resolvedProviders: OAuthAvailability = providers ?? {
    google: showGoogleOAuth,
    twitter: false,
    apple: false,
  }

  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // Cached credentials between the password step and the 2FA challenge — we
  // need to re-submit the same email/password along with the TOTP code.
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)
  const [code, setCode] = useState("")

  async function submitCredentials(payload: {
    email: string
    password: string
    code?: string
  }) {
    const result = await signIn("credentials", {
      ...payload,
      redirect: false,
    })

    if (result?.error) {
      if (result.code === "TwoFactorRequired") {
        setTwoFactorRequired(true)
        setError("")
        return
      }
      if (result.code === "TwoFactorInvalid") {
        setError("Invalid 2FA code. Try again.")
        return
      }
      setError("Invalid email or password")
      setTwoFactorRequired(false)
      return
    }

    router.push("/dashboard")
    router.refresh()
  }

  async function onCredentialsSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError("")
    try {
      const formData = new FormData(e.currentTarget)
      const nextEmail = (formData.get("email") as string)?.trim() ?? ""
      const nextPassword = (formData.get("password") as string) ?? ""
      setEmail(nextEmail)
      setPassword(nextPassword)
      await submitCredentials({ email: nextEmail, password: nextPassword })
    } finally {
      setLoading(false)
    }
  }

  async function on2faSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!code) return
    setLoading(true)
    setError("")
    try {
      await submitCredentials({ email, password, code })
    } finally {
      setLoading(false)
    }
  }

  if (twoFactorRequired) {
    return (
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Two-Factor Verification</CardTitle>
          <CardDescription>
            Enter the 6-digit code from your authenticator app, or one of your backup codes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={on2faSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="totp">Authentication code</FieldLabel>
              <Input
                id="totp"
                name="totp"
                inputMode="text"
                autoComplete="one-time-code"
                placeholder="123456 or backup code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
              />
            </Field>
            <Button
              type="submit"
              variant="gradient"
              size="pill"
              className="w-full"
              disabled={loading || code.trim().length < 6}
            >
              {loading ? "Verifying..." : "Verify"}
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground hover:underline"
              onClick={() => {
                setTwoFactorRequired(false)
                setCode("")
                setError("")
              }}
            >
              Back to sign-in
            </button>
          </form>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
        <CardDescription>Sign in to your account to continue</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {(resolvedProviders.google ||
            resolvedProviders.twitter ||
            resolvedProviders.apple) && (
            <>
              <OAuthButtons providers={resolvedProviders} />
              <FieldSeparator>or</FieldSeparator>
            </>
          )}

          <form onSubmit={onCredentialsSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
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
            <div className="flex justify-end">
              <Link
                href="/forgot-password"
                className="text-xs text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <Button
              type="submit"
              variant="gradient"
              size="pill"
              className="w-full"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href="/register" className="text-primary hover:underline">
                Sign up
              </Link>
            </p>
          </form>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
