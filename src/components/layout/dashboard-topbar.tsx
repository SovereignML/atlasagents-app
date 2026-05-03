"use client"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import Link from "next/link"
import { User, Bot, CreditCard, Settings, LogOut } from "lucide-react"
import { signOutAction } from "@/app/actions/auth"
import { ThemeToggle } from "@/components/ui/theme-toggle"

function UserAvatar({ name, email }: { name?: string | null; email?: string | null }) {
  const initials = (name || email || "U")
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("")

  return (
    <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold text-xs">
      {initials}
    </div>
  )
}

export function DashboardTopbar() {
  const { data: session } = useSession()
  const router = useRouter()
  const isAdmin = (session?.user as { role?: string })?.role === "admin"

  return (
    <header className="h-[64px] border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center justify-between px-6">
      <div className="lg:hidden">
        <Link
          href="/"
          className="text-lg font-bold text-[var(--text-primary)]"
        >
          SovereignML
        </Link>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        <ThemeToggle className="w-8 h-8" />
        {isAdmin && (
          <Link
            href="/admin"
            className="rounded-full bg-primary/10 text-primary text-xs font-medium px-3 py-1.5 transition-colors hover:bg-primary/20"
          >
            Admin
          </Link>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 hover:bg-[var(--card-hover)] rounded-lg px-2 py-1.5 transition-colors outline-none cursor-pointer">
            <UserAvatar name={session?.user?.name} email={session?.user?.email} />
            <span className="hidden sm:block text-sm text-[var(--text-secondary)] max-w-[160px] truncate">
              {session?.user?.name || session?.user?.email || "Account"}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56 bg-[var(--card-bg)] border-[var(--border-color)]"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-3 py-2">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {session?.user?.name || "User"}
                </p>
                <p className="text-xs text-[var(--text-secondary)] truncate">
                  {session?.user?.email}
                </p>
                {isAdmin && (
                  <span className="inline-block mt-1 px-2 py-0.5 text-[0.65rem] font-medium rounded-full bg-primary/10 text-primary">
                    Admin
                  </span>
                )}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="bg-[var(--border-color)]" />
            <DropdownMenuItem
              className="flex items-center gap-2 text-[var(--text-secondary)] cursor-pointer text-sm"
              onClick={() => router.push("/dashboard/account")}
            >
              <User className="w-4 h-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center gap-2 text-[var(--text-secondary)] cursor-pointer text-sm"
              onClick={() => router.push("/dashboard/instances")}
            >
              <Bot className="w-4 h-4" />
              My Agents
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center gap-2 text-[var(--text-secondary)] cursor-pointer text-sm"
              onClick={() => router.push("/dashboard/billing")}
            >
              <CreditCard className="w-4 h-4" />
              Billing
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center gap-2 text-[var(--text-secondary)] cursor-pointer text-sm"
              onClick={() => router.push("/dashboard/account")}
            >
              <Settings className="w-4 h-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-[var(--border-color)]" />
            <DropdownMenuItem
              className="flex items-center gap-2 text-red-500 cursor-pointer text-sm"
              onClick={() => void signOutAction()}
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
