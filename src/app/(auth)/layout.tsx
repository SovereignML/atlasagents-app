import Link from "next/link"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell flex min-h-screen items-center justify-center bg-background px-5 py-12 text-foreground">
      <div className="relative z-10 w-full max-w-lg space-y-8">
        <div className="text-center">
          <Link href="/" className="inline-block text-2xl font-bold text-foreground">
            SovereignML
          </Link>
        </div>
        {children}
      </div>
    </div>
  )
}
