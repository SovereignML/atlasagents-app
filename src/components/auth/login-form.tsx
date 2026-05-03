"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { signInWithGoogle } from "@/app/actions/auth"

export function LoginForm({ showGoogleOAuth = false }: { showGoogleOAuth?: boolean }) {
  const router = useRouter()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError("")

    const formData = new FormData(e.currentTarget)
    const email = formData.get("email") as string
    const password = formData.get("password") as string

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    })

    if (result?.error) {
      setError("Invalid email or password")
      setLoading(false)
      return
    }

    router.push("/dashboard")
    router.refresh()
  }

  return (
    <div className="w-full rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-md)] p-8">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">
          Welcome Back
        </h2>
        <p className="text-[var(--text-secondary)] text-sm mt-1">Sign in to your account to continue</p>
      </div>

      {showGoogleOAuth && (
        <form action={signInWithGoogle}>
          <button
            type="submit"
            className="w-full rounded-lg border border-[var(--border-color)] bg-transparent hover:bg-[var(--card-hover)] text-[var(--text-primary)] py-3 flex items-center justify-center gap-3 transition-all duration-200 text-sm font-medium"
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
          <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-500 text-sm">
            {error}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="email" className="text-[var(--text-secondary)] text-sm font-medium">
            Email
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            required
            className="bg-transparent border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:border-[var(--accent-color)]"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className="text-[var(--text-secondary)] text-sm font-medium">
            Password
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            required
            minLength={6}
            className="bg-transparent border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:border-[var(--accent-color)]"
          />
        </div>
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-xs text-[var(--accent-color)] hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="gradient" size="pill" className="w-full" disabled={loading}>
          {loading ? "Signing in..." : "Sign In"}
        </Button>
        <p className="text-center text-sm text-[var(--text-secondary)]">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-[var(--accent-color)] hover:underline">
            Sign up
          </Link>
        </p>
      </form>
    </div>
  )
}
