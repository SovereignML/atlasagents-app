import Link from "next/link"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-color)] px-5 py-10">
      <div className="relative z-10 w-full max-w-lg">
        <div className="text-center mb-8">
          <Link
            href="/"
            className="inline-block text-2xl font-bold text-[var(--text-primary)]"
          >
            SovereignML
          </Link>
        </div>
        {children}
      </div>
    </div>
  )
}
