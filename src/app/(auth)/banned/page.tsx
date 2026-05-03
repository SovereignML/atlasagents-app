import Link from "next/link"

export default function BannedPage() {
  return (
    <div className="text-center space-y-6 max-w-md mx-auto">
      <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
        <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold text-[var(--text-primary)]">Account Suspended</h1>
      <p className="text-[var(--text-secondary)] leading-relaxed">
        Your account has been suspended. If you believe this is a mistake,
        please contact our support team for assistance.
      </p>
      <div className="flex flex-col gap-3 pt-2">
        <Link
          href="/community"
          className="bg-blue-600 hover:bg-blue-500 text-[var(--text-primary)] font-medium px-6 py-3 rounded-xl transition-colors text-sm"
        >
          Contact Support
        </Link>
        <Link
          href="/"
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm transition-colors"
        >
          Back to Home
        </Link>
      </div>
    </div>
  )
}
