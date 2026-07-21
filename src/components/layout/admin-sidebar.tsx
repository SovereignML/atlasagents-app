"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Server,
  CreditCard,
  Users,
  DollarSign,
  Bell,
  Network,
  ArrowLeft,
  Wallet,
  UserX,
  Building2,
  DatabaseBackup,
  Cpu,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
    label: "Overview",
    items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Operations",
    items: [
      { href: "/admin/instances", label: "Instances", icon: Server },
      { href: "/admin/providers", label: "Providers", icon: Network },
      { href: "/admin/models", label: "Models", icon: Cpu },
      { href: "/admin/backups", label: "Backups", icon: DatabaseBackup },
    ],
  },
  {
    label: "Accounts",
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/teams", label: "Teams", icon: Building2 },
      { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
      { href: "/admin/deletion-requests", label: "Deletion Requests", icon: UserX },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/admin/revenue", label: "Revenue", icon: DollarSign },
      { href: "/admin/billing", label: "Billing", icon: Wallet },
      { href: "/admin/notifications", label: "Notifications", icon: Bell },
    ],
  },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/admin"
          className="flex items-center text-lg font-semibold tracking-tight group-data-[collapsible=icon]:justify-center"
        >
          <span className="group-data-[collapsible=icon]:hidden">SovereignML</span>
          <span className="hidden group-data-[collapsible=icon]:inline">S</span>
        </Link>
        <Badge variant="secondary" className="w-fit group-data-[collapsible=icon]:hidden">
          Admin
        </Badge>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
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
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Back to Dashboard"
              render={
                <Link href="/dashboard">
                  <ArrowLeft />
                  <span>Back to Dashboard</span>
                </Link>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
