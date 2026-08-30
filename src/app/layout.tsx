import type { Metadata } from "next"
import { Inter, Geist_Mono } from "next/font/google"
import { BRANDING } from "@/configs/branding"
import { AppProviders } from "@/components/app-providers"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
})

// Geist Mono — the console's mono face for machine values (slugs, IPs, tokens),
// chart axis labels, and the uppercase nav group labels.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const DESCRIPTION =
  "The AI operations platform. Deploy intelligent agents that automate real tasks: support, DevOps, sales, content, and more. Your own isolated instances, no single-vendor lock-in, zero complexity."

export const metadata: Metadata = {
  // Resolves relative OG/Twitter image paths against the deployed origin.
  metadataBase: new URL(BRANDING.appUrl),
  title: { default: BRANDING.name, template: `%s | ${BRANDING.name}` },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: BRANDING.name,
    title: BRANDING.name,
    description: DESCRIPTION,
    url: BRANDING.appUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: BRANDING.name,
    description: DESCRIPTION,
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // Dark-only: the `dark` class (and matching color-scheme) is hard-coded here
    // server-side instead of via next-themes. That renders the theme tokens from
    // SSR with zero flash and no injected anti-FOUC script — see AppProviders.
    <html
      lang="en"
      className={`dark ${inter.variable} ${geistMono.variable} h-full antialiased`}
      style={{ colorScheme: "dark" }}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <AppProviders>{children}</AppProviders>
        <Toaster />
      </body>
    </html>
  )
}
