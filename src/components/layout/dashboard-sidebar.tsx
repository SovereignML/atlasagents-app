"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Rocket,
  Bot,
  Server,
  Activity,
  Bell,
  CreditCard,
  Users,
  FileText,
  Settings,
  LifeBuoy,
  Palette,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

type NavItem = {
  href: string
  label: string
  icon: typeof LayoutDashboard
}

type NavGroup = {
  label: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/dashboard/monitoring", label: "Monitoring", icon: Activity },
      { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Agents",
    items: [
      { href: "/dashboard/deploy", label: "Deploy Agent", icon: Rocket },
      { href: "/dashboard/instances", label: "My Agents", icon: Bot },
      { href: "/dashboard/byos", label: "Bring Your Own Server", icon: Server },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/dashboard/billing", label: "Billing & Credits", icon: CreditCard },
      { href: "/dashboard/team", label: "Team", icon: Users },
      { href: "/dashboard/audit-log", label: "Audit Log", icon: FileText },
      { href: "/dashboard/support", label: "Support", icon: LifeBuoy },
      { href: "/dashboard/account", label: "Settings", icon: Settings },
    ],
  },
]

type DashboardSidebarProps = {
  /** Resolved white-label brand name; defaults to the platform name. */
  brandName?: string
  /** Expanded logo image URL (falls back to the brand name text). */
  logoUrl?: string | null
  /** Collapsed/icon logo image URL (falls back to the brand initial). */
  logoMarkUrl?: string | null
  /** Show the Branding nav item (owner/admin of a white-label-entitled team). */
  canManageBranding?: boolean
}

export function DashboardSidebar({
  brandName = "SovereignML",
  logoUrl = null,
  logoMarkUrl = null,
  canManageBranding = false,
}: DashboardSidebarProps) {
  const pathname = usePathname()
  const initial = brandName.trim().charAt(0).toUpperCase() || "S"

  const groups: NavGroup[] = canManageBranding
    ? navGroups.map((g) =>
        g.label === "Account"
          ? {
              ...g,
              items: [
                ...g.items,
                {
                  href: "/dashboard/settings/branding",
                  label: "Branding",
                  icon: Palette,
                },
              ],
            }
          : g,
      )
    : navGroups

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/"
          aria-label={brandName}
          className="flex items-center text-lg font-semibold tracking-tight group-data-[collapsible=icon]:justify-center"
        >
          {logoUrl ? (
            // Tenant logos are arbitrary external URLs; next/image would need
            // each host pre-registered in remotePatterns, so a plain <img> is
            // the correct choice here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={brandName}
              className="h-7 w-auto max-w-[160px] object-contain group-data-[collapsible=icon]:hidden"
            />
          ) : (
            <span className="group-data-[collapsible=icon]:hidden">{brandName}</span>
          )}
          {logoMarkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoMarkUrl}
              alt={brandName}
              className="hidden h-7 w-7 object-contain group-data-[collapsible=icon]:inline-block"
            />
          ) : (
            <span className="hidden group-data-[collapsible=icon]:inline">{initial}</span>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon
                  const active = pathname === item.href
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.label}
                        render={
                          <Link href={item.href}>
                            <Icon />
                            <span>{item.label}</span>
                          </Link>
                        }
                      />
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}
