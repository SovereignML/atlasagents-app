"use client"

import { useSession } from "next-auth/react"
import { usePostHog } from "posthog-js/react"
import { useEffect } from "react"

// Ties PostHog identity to the next-auth session: identify on sign-in, reset
// on sign-out. Sign-out redirects to /, so reset fires on the post-redirect
// render — no need to hook the sign-out button itself.
export function PostHogIdentify() {
  const { data: session, status } = useSession()
  const posthog = usePostHog()

  useEffect(() => {
    if (!posthog) return
    if (status === "authenticated" && session?.user?.id) {
      const id = session.user.id
      // Only identify when the distinct id actually changes — avoids
      // re-identify loops on every session refetch.
      if (posthog.get_distinct_id() !== id) {
        posthog.identify(id, {
          email: session.user.email ?? undefined,
          name: session.user.name ?? undefined,
          role: session.user.role,
        })
      }
    } else if (status === "unauthenticated" && posthog._isIdentified()) {
      posthog.reset()
    }
  }, [status, session?.user?.id, session?.user?.email, session?.user?.name, session?.user?.role, posthog])

  return null
}
