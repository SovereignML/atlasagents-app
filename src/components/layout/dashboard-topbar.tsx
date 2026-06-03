"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ChevronDown,
  CircleCheck,
  CreditCard,
  Headset,
  LogOut,
  Plus,
  Settings,
  ShieldCheck,
  User,
  Users,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { signOutAction } from "@/app/actions/auth"
import { cn } from "@/lib/utils"

function getInitials(name?: string | null, email?: string | null) {
  return (name || email || "U")
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("")
}

// Deterministic vivid tint for a team's initial avatar, hashed from its id so a
// given team always gets the same color.
const TEAM_COLORS = [
  "bg-orange-500",
  "bg-violet-500",
  "bg-pink-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-indigo-500",
  "bg-teal-500",
  "bg-fuchsia-500",
]

function teamColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return TEAM_COLORS[h % TEAM_COLORS.length]
}

function teamInitial(name: string) {
  return (name.trim()[0] || "T").toUpperCase()
}

type TeamOption = { teamId: string; name: string; role: string }

export function DashboardTopbar({
  brandName = "SovereignML",
  teams = [],
  activeTeamId,
}: {
  brandName?: string
  teams?: TeamOption[]
  activeTeamId?: string
}) {
  const { data: session } = useSession()
  const router = useRouter()
  const isAdmin = (session?.user as { role?: string })?.role === "admin"
  const initials = getInitials(session?.user?.name, session?.user?.email)
  const displayName = session?.user?.name || session?.user?.email || "Account"

  const [switching, setSwitching] = useState(false)
  const activeTeam = teams.find((t) => t.teamId === activeTeamId) ?? teams[0]

  const [createOpen, setCreateOpen] = useState(false)
  const [newTeamName, setNewTeamName] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function switchTeam(teamId: string) {
    if (teamId === activeTeam?.teamId || switching) return
    setSwitching(true)
    const res = await fetch("/api/team/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId }),
    })
    if (res.ok) {
      // Re-resolves branding + team-scoped data on the server.
      router.refresh()
    }
    setSwitching(false)
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = newTeamName.trim()
    if (!name || creating) return
    setCreating(true)
    setCreateError(null)
    const res = await fetch("/api/team/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    setCreating(false)
    if (res.ok) {
      setCreateOpen(false)
      setNewTeamName("")
      // The new team is active server-side; refresh to pick it up everywhere.
      router.refresh()
      return
    }
    const data = await res.json().catch(() => ({}))
    setCreateError(data.error || "Failed to create team")
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-sidebar/80 px-6 backdrop-blur supports-[backdrop-filter]:bg-sidebar/60 lg:px-8">
      <SidebarTrigger />
      <Link href="/" className="text-sm font-semibold tracking-tight md:hidden">
        {brandName}
      </Link>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="size-8 px-0"
          aria-label="Support"
          render={
            <Link href="/dashboard/support">
              <Headset className="size-4" />
            </Link>
          }
        />
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
                  <AvatarImage src={session?.user?.image ?? undefined} alt="" />
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <span className="hidden max-w-[160px] truncate text-sm sm:inline">
                  {displayName}
                </span>
                <ChevronDown className="hidden size-4 shrink-0 opacity-60 sm:inline" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Signed in as
            </DropdownMenuLabel>
            <div className="flex items-center gap-2 px-2 pb-2">
              <Avatar size="default">
                <AvatarImage src={session?.user?.image ?? undefined} alt="" />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">
                  {session?.user?.name || "User"}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {session?.user?.email}
                </div>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {teams.map((t) => {
                const active = t.teamId === activeTeam?.teamId
                return (
                  <DropdownMenuItem
                    key={t.teamId}
                    onClick={() => void switchTeam(t.teamId)}
                    disabled={switching}
                    className="gap-2"
                  >
                    <Avatar size="sm">
                      <AvatarFallback className={cn(teamColor(t.teamId), "text-white")}>
                        {teamInitial(t.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      className={cn(
                        "flex-1 truncate",
                        active && "font-medium text-primary"
                      )}
                    >
                      {t.name}
                    </span>
                    {active && <CircleCheck className="size-4 shrink-0 text-primary" />}
                  </DropdownMenuItem>
                )
              })}
              <DropdownMenuItem
                onClick={() => setCreateOpen(true)}
                className="gap-2 text-muted-foreground"
              >
                <Plus className="size-4" />
                Create New Team
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/dashboard/team")}>
              <Users />
              Team
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/dashboard/account")}>
              <Settings />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/dashboard/account")}>
              <User />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/dashboard/billing")}>
              <CreditCard />
              Billing
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => void signOutAction()}>
              <LogOut />
              Log Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          setCreateError(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a new team</DialogTitle>
            <DialogDescription>
              You&apos;ll be switched to the new team once it&apos;s created.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="team-name">Team name</FieldLabel>
                <Input
                  id="team-name"
                  required
                  autoFocus
                  maxLength={50}
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="Acme Inc"
                />
              </Field>
            </FieldGroup>
            {createError && (
              <p className="text-sm text-destructive" role="alert">
                {createError}
              </p>
            )}
            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                }
              />
              <Button type="submit" disabled={creating || !newTeamName.trim()}>
                Create team
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </header>
  )
}
