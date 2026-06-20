import type { Metadata } from "next"
import { Inter, Geist_Mono } from "next/font/google"
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

export const metadata: Metadata = {
  title: "SovereignML",
  description: "The AI operations platform. Deploy intelligent agents that automate real tasks: support, DevOps, sales, content, and more. Your own isolated instances, no single-vendor lock-in, zero complexity.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <AppProviders>{children}</AppProviders>
        <Toaster />
      </body>
    </html>
  )
}
