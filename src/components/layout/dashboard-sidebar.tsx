"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const navItems = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/deploy", label: "Deploy Agent" },
  { href: "/dashboard/instances", label: "My Agents" },
  { href: "/dashboard/monitoring", label: "Monitoring" },
  { href: "/dashboard/billing", label: "Billing" },
  { href: "/dashboard/subscriptions", label: "Subscriptions" },
  { href: "/dashboard/team", label: "Team" },
  { href: "/dashboard/audit-log", label: "Audit Log" },
  { href: "/dashboard/account", label: "Settings" },
]

export function DashboardSidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden lg:flex w-64 flex-col border-r border-[var(--border-color)] bg-[var(--bg-secondary)] p-6">
      <Link
        href="/"
        className="text-xl font-bold text-[var(--text-primary)] mb-10"
      >
        SovereignML
      </Link>
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
    </aside>
  )
}
