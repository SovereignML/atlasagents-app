"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const navItems = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/instances", label: "Instances" },
  { href: "/admin/subscriptions", label: "Subscriptions" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/revenue", label: "Revenue" },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden lg:flex w-64 flex-col border-r border-[var(--border-color)] bg-[var(--bg-secondary)] p-6">
      <Link
        href="/admin"
        className="text-xl font-bold text-[var(--text-primary)] mb-2"
      >
        SovereignML
      </Link>
      <span className="inline-block mb-8 px-2 py-0.5 text-xs font-medium rounded-full bg-primary/10 text-primary w-fit">
        Admin
      </span>
      <nav className="space-y-1 flex-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`block px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
              pathname === item.href
                ? "text-primary bg-primary/10"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover)]"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <Link
        href="/dashboard"
        className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        ← Back to Dashboard
      </Link>
    </aside>
  )
}
