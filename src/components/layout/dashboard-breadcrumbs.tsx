"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

// Friendly labels for known dashboard segments. Mirrors the sidebar nav so the
// breadcrumb trail reads the same as the navigation the user clicked.
const LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  monitoring: "Monitoring",
  notifications: "Notifications",
  deploy: "Deploy Agent",
  instances: "Agents",
  byos: "Bring Your Own Server",
  connect: "Connect",
  billing: "Billing & Credits",
  team: "Team",
  "audit-log": "Audit Log",
  support: "Support",
  account: "Settings",
  "api-keys": "API Keys",
  subscriptions: "Subscriptions",
  "ssh-keys": "SSH Keys",
  settings: "Settings",
  branding: "Branding",
}

/**
 * Full-path overrides, checked before the per-segment labels.
 *
 * Needed where the same segment means different things in different places:
 * "deploy" under /dashboard is the managed-VPS wizard, but under /dashboard/byos
 * it installs an agent onto hardware the customer already owns — nothing is
 * deployed on our side, so "Deploy Agent" read wrong there.
 */
const PATH_LABELS: Record<string, string> = {
  "/dashboard/byos/deploy": "Install an agent",
  "/dashboard/byos/connect": "Connect a server",
}

function labelFor(segment: string, path: string) {
  return PATH_LABELS[path] ?? LABELS[segment] ?? "Detail"
}

export function DashboardBreadcrumbs() {
  const pathname = usePathname() ?? "/dashboard"
  const segments = pathname.split("/").filter(Boolean)

  // Build cumulative crumbs starting at /dashboard.
  const crumbs = segments.map((segment, i) => {
    const href = "/" + segments.slice(0, i + 1).join("/")
    return {
      label: labelFor(segment, href),
      href,
      isLast: i === segments.length - 1,
    }
  })

  if (crumbs.length === 0) return null

  return (
    <Breadcrumb className="hidden md:flex">
      <BreadcrumbList>
        {crumbs.map((crumb) => (
          <span key={crumb.href} className="inline-flex items-center gap-1.5">
            <BreadcrumbItem>
              {crumb.isLast ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink render={<Link href={crumb.href} />}>
                  {crumb.label}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {!crumb.isLast && <BreadcrumbSeparator />}
          </span>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
