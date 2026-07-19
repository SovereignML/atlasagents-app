"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Bot,
  Palette,
  LifeBuoy,
  ArrowLeft,
  Store,
  LayoutDashboard,
  Building2,
  UserCog,
  CreditCard,
  DatabaseBackup,
  DollarSign,
  Bell,
} from "lucide-react"

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

const navGroups = [
  {
    label: "Overview",
    items: [{ href: "/tenant-admin", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Customers",
    items: [
      { href: "/tenant-admin/customers", label: "Customers", icon: Building2 },
      { href: "/tenant-admin/users", label: "Users", icon: UserCog },
      { href: "/tenant-admin/agents", label: "Agents", icon: Bot },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/tenant-admin/backups", label: "Backups", icon: DatabaseBackup },
      { href: "/tenant-admin/notifications", label: "Notifications", icon: Bell },
      { href: "/tenant-admin/support", label: "Support Inbox", icon: LifeBuoy },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/tenant-admin/subscriptions", label: "Subscriptions", icon: CreditCard },
      { href: "/tenant-admin/revenue", label: "Revenue", icon: DollarSign },
    ],
  },
  {
    label: "Configuration",
    items: [{ href: "/tenant-admin/settings", label: "Branding & Settings", icon: Palette }],
  },
]

export function TenantAdminSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 text-lg font-semibold tracking-tight group-data-[collapsible=icon]:justify-center">
          <Store className="h-5 w-5" />
          <span className="group-data-[collapsible=icon]:hidden">Reseller Admin</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon
                  const active =
                    item.href === "/tenant-admin"
                      ? pathname === "/tenant-admin"
                      : pathname.startsWith(item.href)
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
              tooltip="Back to dashboard"
              render={
                <Link href="/dashboard">
                  <ArrowLeft />
                  <span>Back to dashboard</span>
                </Link>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
