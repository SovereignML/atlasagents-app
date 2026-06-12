"use client"

import { SessionProvider } from "next-auth/react"
import { ThemeProvider } from "next-themes"
import { ChatwootWidget } from "@/components/chatwoot-widget"
import { PostHogProvider } from "@/components/posthog-provider"
import { AdClickCapture } from "@/components/ad-click-capture"
import { ConsentBanner } from "@/components/consent-banner"

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
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
