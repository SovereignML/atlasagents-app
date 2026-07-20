"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Users, Bot, Palette, LifeBuoy, ArrowLeft, Store } from "lucide-react"

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

const navItems = [
  { href: "/tenant-admin", label: "Customers", icon: Users },
  { href: "/tenant-admin/agents", label: "Agents", icon: Bot },
  { href: "/tenant-admin/support", label: "Support Inbox", icon: LifeBuoy },
  { href: "/tenant-admin/settings", label: "Branding & Settings", icon: Palette },
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
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
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
