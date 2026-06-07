"use client"

import { SessionProvider } from "next-auth/react"
import { ThemeProvider } from "next-themes"
import { ChatwootWidget } from "@/components/chatwoot-widget"
import { PostHogProvider } from "@/components/posthog-provider"

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <SessionProvider refetchOnWindowFocus refetchWhenOffline={false}>
        {/* Inside SessionProvider so PostHogIdentify can read useSession() */}
        <PostHogProvider>
          {children}
          <ChatwootWidget />
        </PostHogProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
