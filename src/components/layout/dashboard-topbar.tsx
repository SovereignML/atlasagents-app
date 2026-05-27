"use client"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Bot, CreditCard, LogOut, Settings, ShieldCheck, User } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { signOutAction } from "@/app/actions/auth"

function getInitials(name?: string | null, email?: string | null) {
  return (name || email || "U")
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("")
}

export function DashboardTopbar({ brandName = "SovereignML" }: { brandName?: string }) {
  const { data: session } = useSession()
  const router = useRouter()
  const isAdmin = (session?.user as { role?: string })?.role === "admin"
  const initials = getInitials(session?.user?.name, session?.user?.email)
  const displayName = session?.user?.name || session?.user?.email || "Account"

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-sidebar/80 px-6 backdrop-blur supports-[backdrop-filter]:bg-sidebar/60 lg:px-8">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-2 h-5" />
      <Link href="/" className="text-sm font-semibold tracking-tight md:hidden">
        {brandName}
      </Link>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <NotificationBell />
        <ThemeToggle className="size-8" />
        {isAdmin && (
          <Button
            size="sm"
            variant="secondary"
            render={
              <Link href="/admin">
                <ShieldCheck data-icon="inline-start" />
                Admin
              </Link>
            }
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="sm" className="gap-2 px-2">
                <Avatar size="sm">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <span className="hidden max-w-[160px] truncate text-sm sm:inline">
                  {displayName}
                </span>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-1">
                <span className="text-sm font-medium text-foreground">
                  {session?.user?.name || "User"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {session?.user?.email}
                </span>
                {isAdmin && (
                  <Badge variant="secondary" className="mt-1 w-fit">
                    Admin
                  </Badge>
                )}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/dashboard/account")}>
              <User />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/dashboard/instances")}>
              <Bot />
              My Agents
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/dashboard/billing")}>
              <CreditCard />
              Billing
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/dashboard/account")}>
              <Settings />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void signOutAction()}>
              <LogOut />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
