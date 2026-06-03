"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
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
  ChevronRight,
  HardDriveDownload,
  Plug,
  KeyRound,
  UsersRound,
  Store,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

type Icon = typeof LayoutDashboard

type SubItem = {
  href: string
  label: string
  icon: Icon
  /** The ?tab= value this sub-link targets (for active-state matching). */
  tab: string
}

type NavItem = {
  href: string
  label: string
  icon: Icon
  /** When present, this item is an expandable parent. */
  children?: SubItem[]
}

type NavGroup = {
  label: string
  items: NavItem[]
}

const TEAM_SUBITEMS: SubItem[] = [
  { href: "/dashboard/team?tab=members", label: "Members", icon: UsersRound, tab: "members" },
  {
    href: "/dashboard/team?tab=backups",
    label: "Backup Providers",
    icon: HardDriveDownload,
    tab: "backups",
  },
  { href: "/dashboard/team?tab=integrations", label: "Integrations", icon: Plug, tab: "integrations" },
  { href: "/dashboard/team?tab=ssh", label: "SSH Keys", icon: KeyRound, tab: "ssh" },
]

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
      { href: "/dashboard/team", label: "Team", icon: Users, children: TEAM_SUBITEMS },
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
  /** Show the Branding sub-tab (owner/admin of a white-label-entitled team). */
  canManageBranding?: boolean
  /** Show the Reseller (tenant admin) entry — enterprise owner/admin. */
  canManageTenant?: boolean
}

/** Expandable parent ("Team") with its sub-tab links. */
function TeamNavItem({
  item,
  subItems,
}: {
  item: NavItem
  subItems: SubItem[]
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const onTeam = pathname === item.href
  const activeTab = onTeam ? searchParams.get("tab") || "members" : null
  const [open, setOpen] = useState(onTeam)
  const Icon = item.icon

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={onTeam}
          tooltip={item.label}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon />
          <span className="flex-1 group-data-[collapsible=icon]:hidden">{item.label}</span>
          <ChevronRight
            className={`transition-transform group-data-[collapsible=icon]:hidden ${open ? "rotate-90" : ""}`}
            data-icon="inline-end"
          />
        </SidebarMenuButton>
      </SidebarMenuItem>
      {open && (
        <SidebarMenuSub>
          {subItems.map((sub) => {
            const SubIcon = sub.icon
            return (
              <SidebarMenuSubItem key={sub.href}>
                <SidebarMenuSubButton
                  isActive={activeTab === sub.tab}
                  render={
                    <Link href={sub.href}>
                      <SubIcon />
                      <span>{sub.label}</span>
                    </Link>
                  }
                />
              </SidebarMenuSubItem>
            )
          })}
        </SidebarMenuSub>
      )}
    </>
  )
}

export function DashboardSidebar({
  brandName = "SovereignML",
  logoUrl = null,
  logoMarkUrl = null,
  canManageBranding = false,
  canManageTenant = false,
}: DashboardSidebarProps) {
  const pathname = usePathname()
  const initial = brandName.trim().charAt(0).toUpperCase() || "S"

  // The Branding sub-tab only exists for white-label-entitled owners/admins.
  const teamSubItems: SubItem[] = canManageBranding
    ? [
        ...TEAM_SUBITEMS,
        { href: "/dashboard/team?tab=branding", label: "Branding", icon: Palette, tab: "branding" },
      ]
    : TEAM_SUBITEMS

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
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  if (item.children) {
                    return (
                      <TeamNavItem key={item.href} item={item} subItems={teamSubItems} />
                    )
                  }
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
        {canManageTenant && (
          <SidebarGroup>
            <SidebarGroupLabel>Reseller</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname.startsWith("/tenant-admin")}
                    tooltip="Reseller Admin"
                    render={
                      <Link href="/tenant-admin">
                        <Store />
                        <span>Reseller Admin</span>
                      </Link>
                    }
                  />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  )
}
