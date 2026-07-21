"use client"

import { useState } from "react"
import { LogOut, VenetianMask } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

function initials(name: string | null, email: string) {
  const source = (name ?? email).trim()
  if (!source) return "?"
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

export function ImpersonationBanner({
  email,
  name,
  actingAsTeamName,
  returnTo = "/admin/users",
}: {
  userId: string
  email: string
  name: string | null
  /** When set, the banner reads "Acting as customer: <team>" (act-as-team). */
  actingAsTeamName?: string | null
  /** Where "Stop" returns to (tenant admins → /tenant-admin, staff → /admin). */
  returnTo?: string
}) {
  const [stopping, setStopping] = useState(false)
  const actingAsTeam = Boolean(actingAsTeamName)

  async function handleStop() {
    setStopping(true)
    await fetch("/api/admin/stop-impersonation", { method: "POST" })
    window.location.href = returnTo
  }

  return (
    <div
      role="status"
      aria-label={`Impersonation mode active. Viewing as ${name || email}.`}
      className="relative z-10 border-b border-amber-500 bg-amber-400 text-amber-950 motion-safe:animate-[impersonation-enter_260ms_ease-out]"
    >
      <style>{`@keyframes impersonation-enter{from{opacity:0;transform:translateY(-100%)}to{opacity:1;transform:translateY(0)}}`}</style>

      <div className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
        {/* Live indicator + mode label */}
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="relative flex size-2.5" aria-hidden="true">
            <span className="absolute inline-flex size-full rounded-full bg-amber-900/50 motion-safe:animate-ping" />
            <span className="relative inline-flex size-2.5 rounded-full bg-amber-900" />
          </span>
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-amber-950"
            aria-hidden="true"
          >
            <VenetianMask className="size-4" />
          </span>
          <span className="text-[0.8125rem] font-semibold tracking-tight">
            {actingAsTeam ? "Acting as customer" : "Impersonation mode"}
          </span>
        </div>

        {/* Identity */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="hidden text-amber-900/80 sm:inline">
            {actingAsTeam ? "Managing" : "Viewing as"}
          </span>
          <Avatar size="sm" className="shrink-0 after:border-amber-600/40">
            <AvatarFallback className="bg-amber-500 text-[0.625rem] font-semibold text-amber-950">
              {initials(actingAsTeamName ?? name, email)}
            </AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[0.8125rem] font-semibold">
              {actingAsTeamName ?? name ?? email}
            </span>
            {!actingAsTeam && name && (
              <span className="hidden truncate text-xs text-amber-900/70 md:inline">
                {email}
              </span>
            )}
          </span>
        </div>

        {/* Exit action — primary CTA on this bar */}
        <Button
          size="sm"
          onClick={handleStop}
          disabled={stopping}
          aria-label="Stop impersonating and return to admin"
          className="shrink-0 border border-amber-950/20 bg-amber-950 text-amber-50 hover:bg-amber-900 focus-visible:ring-amber-900/40 disabled:opacity-70"
        >
          <LogOut data-icon="inline-start" />
          {stopping ? "Stopping…" : "Stop"}
        </Button>
      </div>
    </div>
  )
}
