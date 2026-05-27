"use client"

import { SessionProvider } from "next-auth/react"
import { ThemeProvider } from "next-themes"
import { ChatwootWidget } from "@/components/chatwoot-widget"

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <SessionProvider refetchOnWindowFocus refetchWhenOffline={false}>
        {children}
        <ChatwootWidget />
      </SessionProvider>
    </ThemeProvider>
  )
}
