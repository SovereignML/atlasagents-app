"use client"

// Scoped error boundary for the dashboard. Catches render/data errors in any
// dashboard route, keeps the rest of the app shell intact, reports to Sentry,
// and offers a retry. Mirrors src/app/global-error.tsx (the root fallback).

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        We hit an unexpected error loading this page. It has been reported and
        we&apos;re on it.
      </p>
      <Button onClick={reset} variant="outline">
        Try again
      </Button>
    </div>
  )
}
