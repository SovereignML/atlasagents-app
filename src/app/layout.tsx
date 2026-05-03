import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { AppProviders } from "@/components/app-providers"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
})

export const metadata: Metadata = {
  title: "SovereignML — Launch AI Agents That Actually Work",
  description: "The AI operations platform. Deploy intelligent agents that automate real tasks — support, DevOps, sales, content, and more. Full ownership, zero complexity.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <AppProviders>{children}</AppProviders>
        <Toaster />
      </body>
    </html>
  )
}
