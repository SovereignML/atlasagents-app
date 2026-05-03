"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { signInWithGoogle } from "@/app/actions/auth"

export function RegisterForm({ showGoogleOAuth = false }: { showGoogleOAuth?: boolean }) {
  const router = useRouter()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const formData = new FormData(e.currentTarget)
    const name = formData.get("name") as string
    const email = formData.get("email") as string
    const password = formData.get("password") as string

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || "Something went wrong")
      setLoading(false)
      return
    }

    router.push("/login?registered=true")
  }

  return (
    <Card className="w-full bg-[var(--card-bg)] backdrop-blur-xl border-[var(--border-color)]">
      <CardHeader className="text-center pb-4 pt-8 px-8">
        <CardTitle className="text-2xl font-bold text-[var(--text-primary)]">Create Account</CardTitle>
        <CardDescription className="text-[var(--text-secondary)]">
          Get started with your trading bot subscription
        </CardDescription>
      </CardHeader>
      <CardContent className="px-8 pb-8">
        {showGoogleOAuth && (
          <form action={signInWithGoogle}>
            <button
              type="submit"
              className="w-full border border-[var(--border-color)] bg-[var(--card-bg)] hover:bg-white/10 text-[var(--text-primary)] py-3 rounded-xl flex items-center justify-center gap-3 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
          </form>
        )}

        {showGoogleOAuth && (
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[var(--border-color)]"></div>
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-[var(--card-bg)] px-3 text-[var(--text-secondary)]">or</span>
          </div>
        </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-[var(--text-primary)]">Name</Label>
            <Input
              id="name"
              name="name"
              type="text"
              placeholder="John Doe"
              required
              minLength={2}
              className="bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email" className="text-[var(--text-primary)]">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              required
              className="bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-[var(--text-primary)]">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              required
              minLength={6}
              className="bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50"
            />
          </div>
          <Button type="submit" variant="gradient" size="pill" className="w-full" disabled={loading}>
            {loading ? "Creating account..." : "Create Account"}
          </Button>
          <p className="text-center text-sm text-[var(--text-secondary)]">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
