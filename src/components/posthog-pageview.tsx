"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { Suspense, useEffect } from "react"

// App Router client navigations don't fire $pageview on their own (the
// provider inits with capture_pageview: false), so capture manually on every
// pathname/search-params change — PostHog's documented Next.js approach.
function Tracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const posthog = usePostHog()

  useEffect(() => {
    if (!pathname || !posthog) return
    const qs = searchParams?.toString()
    const url = window.origin + pathname + (qs ? `?${qs}` : "")
    posthog.capture("$pageview", { $current_url: url })
  }, [pathname, searchParams, posthog])

  return null
}

export function PostHogPageview() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  )
}
