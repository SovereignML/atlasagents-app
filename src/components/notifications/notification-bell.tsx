"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Bell, Check } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

export interface NotificationItem {
  id: string
  category: string
  type: string
  title: string
  message: string
  url: string | null
  readAt: string | null
  createdAt: string
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const POLL_MS = 30_000

export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=8", { credentials: "include" })
      if (!res.ok) return
      const data = await res.json()
      setItems(data.notifications ?? [])
      setUnread(data.unreadCount ?? 0)
    } catch {
      /* ignore transient errors */
    }
  }, [])

  useEffect(() => {
    // Defer the first fetch into a timer callback (not the effect body) so the
    // setState inside `load` doesn't trigger a cascading synchronous render.
    const initial = setTimeout(() => void load(), 0)
    const id = setInterval(() => void load(), POLL_MS)
    return () => {
      clearTimeout(initial)
      clearInterval(id)
    }
  }, [load])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) void load() // refresh on open (event handler — safe)
  }

  async function markAllRead() {
    setUnread(0)
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })))
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      })
    } catch {
      /* optimistic — next poll reconciles */
    }
  }

  async function handleClick(n: NotificationItem) {
    setOpen(false)
    if (!n.readAt) {
      setUnread((u) => Math.max(0, u - 1))
      try {
        await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: n.id }),
        })
      } catch {
        /* ignore */
      }
    }
    if (n.url) router.push(n.url)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" className="relative size-8" aria-label="Notifications">
            <Bell />
            {unread > 0 && (
              <Badge
                variant="destructive"
                className="absolute -right-1 -top-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none"
              >
                {unread > 9 ? "9+" : unread}
              </Badge>
            )}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Check className="size-3" />
              Mark all read
            </button>
          )}
        </div>

        <ScrollArea className="max-h-80">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => handleClick(n)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                      !n.readAt && "bg-muted/30",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {!n.readAt && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                      <span className="flex-1 truncate text-sm font-medium">{n.title}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {timeAgo(n.createdAt)}
                      </span>
                    </div>
                    <span className="line-clamp-2 pl-3.5 text-xs text-muted-foreground">
                      {n.message}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>

        <div className="border-t px-3 py-2">
          <Link
            href="/dashboard/notifications"
            onClick={() => setOpen(false)}
            className="block text-center text-xs text-muted-foreground hover:text-foreground"
          >
            View all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
