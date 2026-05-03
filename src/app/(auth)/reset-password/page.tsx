"use client"

import { useState, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get("token")
  const email = searchParams.get("email")

  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  if (!token || !email) {
    return (
      <Card className="w-full bg-[var(--card-bg)] backdrop-blur-xl border-[var(--border-color)]">
        <CardHeader className="text-center pb-4 pt-8 px-8">
          <CardTitle className="text-2xl font-bold text-[var(--text-primary)]">Invalid Link</CardTitle>
          <CardDescription className="text-[var(--text-secondary)]">
            This password reset link is invalid or has expired.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-8 pb-8">
          <Link href="/forgot-password">
            <Button className="w-full bg-blue-600 hover:bg-blue-700">
              Request a New Link
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const formData = new FormData(e.currentTarget)
    const password = formData.get("password") as string
    const confirmPassword = formData.get("confirmPassword") as string

    if (password.length < 6) {
      setError("Password must be at least 6 characters")
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match")
      setLoading(false)
      return
    }

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Something went wrong")
      } else {
        router.push("/login?reset=true")
      }
    } catch {
      setError("Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md bg-[var(--card-bg)] backdrop-blur-xl border-[var(--border-color)]">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold text-[var(--text-primary)]">Reset Password</CardTitle>
        <CardDescription className="text-[var(--text-secondary)]">
          Enter your new password below
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="password" className="text-[var(--text-primary)]">New Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              required
              minLength={6}
              className="bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="text-[var(--text-primary)]">Confirm Password</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              placeholder="••••••••"
              required
              minLength={6}
              className="bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
            />
          </div>
          <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={loading}>
            {loading ? "Resetting..." : "Reset Password"}
          </Button>
          <p className="text-center text-sm text-[var(--text-secondary)]">
            Remember your password?{" "}
            <Link href="/login" className="text-blue-400 hover:text-blue-300">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
