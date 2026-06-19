"use client"

import { SessionProvider } from "next-auth/react"
import { ThemeProvider } from "next-themes"
import { ChatwootWidget } from "@/components/chatwoot-widget"
import { PostHogProvider } from "@/components/posthog-provider"
import { AdClickCapture } from "@/components/ad-click-capture"
import { ConsentBanner } from "@/components/consent-banner"

export function AppProviders({ children }: { children: React.ReactNode }) {
  // Default to dark everywhere; ignore OS preference so the landing page is
  // always dark unless the user explicitly toggles light (persisted).
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <SessionProvider refetchOnWindowFocus refetchWhenOffline={false}>
        {/* Inside SessionProvider so PostHogIdentify can read useSession() */}
        <PostHogProvider>
          {children}
          <ChatwootWidget />
          {/* Capture ad click IDs on landing; show the consent gate that
              governs server-side ad-conversion tracking. */}
          <AdClickCapture />
          <ConsentBanner />
        </PostHogProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
