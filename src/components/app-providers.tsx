"use client"

import { SessionProvider } from "next-auth/react"
import { ChatwootWidget } from "@/components/chatwoot-widget"
import { PostHogProvider } from "@/components/posthog-provider"
import { AdClickCapture } from "@/components/ad-click-capture"
import { ConsentBanner } from "@/components/consent-banner"

export function AppProviders({ children }: { children: React.ReactNode }) {
  // Dark-only for now: the `dark` class is hard-coded on <html> in the root
  // layout, so we don't wrap the tree in next-themes' ThemeProvider. That
  // provider always injects an inline anti-FOUC <script>, which React 19 warns
  // about when it renders client-side — and with a fixed theme it buys nothing.
  return (
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
  )
}
