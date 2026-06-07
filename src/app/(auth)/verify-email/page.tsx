"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type Status = "verifying" | "success" | "error"

function VerifyEmailInner() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const email = searchParams.get("email")

  // Missing params are a render-time fact, so seed them as initial state rather
  // than setting state inside the effect (avoids cascading renders).
  const [status, setStatus] = useState<Status>(token && email ? "verifying" : "error")
  const [message, setMessage] = useState(
    token && email ? "" : "This verification link is invalid.",
  )
  // Guard against React StrictMode double-invoke (and any GET prefetch can't
  // reach this — the token is consumed only by the explicit POST below).
  const ran = useRef(false)

  useEffect(() => {
    if (!token || !email) return
    if (ran.current) return
    ran.current = true

    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, email }),
    })
      .then(async (res) => {
        const data = await res.json()
        if (res.ok) {
          setStatus("success")
        } else {
          setStatus("error")
          setMessage(data.error || "Verification failed.")
        }
      })
      .catch(() => {
        setStatus("error")
        setMessage("Something went wrong.")
      })
  }, [token, email])

  if (status === "verifying") {
    return (
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Verifying…</CardTitle>
          <CardDescription>Confirming your email address.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (status === "success") {
    return (
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Email Verified</CardTitle>
          <CardDescription>
            Your email is confirmed. You can now sign in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="gradient"
            size="pill"
            className="w-full"
            render={<Link href="/login?verified=true" />}
          >
            Continue to Sign In
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">Verification Failed</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="gradient"
          size="pill"
          className="w-full"
          render={<Link href="/login" />}
        >
          Go to Sign In
        </Button>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Once signed in, you can resend the verification email from your dashboard.
        </p>
      </CardContent>
    </Card>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailInner />
    </Suspense>
  )
}
