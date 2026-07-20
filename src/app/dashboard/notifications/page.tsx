"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, Check, Coins, OctagonAlert, Rocket, TriangleAlert, Activity, Trash2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Skeleton } from "@/components/ui/skeleton"
import type { NotificationItem } from "@/components/notifications/notification-bell"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 30

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

type Filter = "all" | "alerts" | "billing"

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "alerts", label: "Alerts" },
  { key: "billing", label: "Billing" },
]

// Failure events get an incident icon + destructive tint regardless of category,
// so a failed deployment never looks like the "Agent is live" success notification.
const FAILURE_TYPES = new Set(["provision_failed", "payment_failed"])

// Visual tile: icon + tint, keyed off the notification type (failures first), then category.
function categoryVisual(category: string, type: string): { Icon: LucideIcon; tile: string } {
  if (FAILURE_TYPES.has(type)) {
    return { Icon: OctagonAlert, tile: "bg-destructive/15 text-destructive" }
  }
  switch (category) {
    case "billing":
      return { Icon: Coins, tile: "bg-primary/15 text-primary" }
    case "provisioning":
      return { Icon: Rocket, tile: "bg-emerald-500/15 text-emerald-500" }
    case "monitoring":
      return { Icon: Activity, tile: "bg-sky-400/15 text-sky-400" }
    case "security":
      return { Icon: TriangleAlert, tile: "bg-amber-400/15 text-amber-400" }
    default:
      return { Icon: Bell, tile: "bg-muted text-muted-foreground" }
  }
}

export default function NotificationsPage() {
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [unread, setUnread] = useState(0)
  const [filter, setFilter] = useState<Filter>("all")

  const fetchPage = useCallback(async (before?: string) => {
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE) })
    if (before) qs.set("before", before)
    const res = await fetch(`/api/notifications?${qs}`, { credentials: "include" })
    if (!res.ok) return { notifications: [] as NotificationItem[], unreadCount: 0 }
    return (await res.json()) as { notifications: NotificationItem[]; unreadCount: number }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const data = await fetchPage()
      if (cancelled) return
      setItems(data.notifications)
      setUnread(data.unreadCount)
      setHasMore(data.notifications.length === PAGE_SIZE)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [fetchPage])

  async function loadMore() {
    if (items.length === 0) return
    setLoadingMore(true)
    const data = await fetchPage(items[items.length - 1].createdAt)
    setItems((prev) => [...prev, ...data.notifications])
    setHasMore(data.notifications.length === PAGE_SIZE)
    setLoadingMore(false)
  }

  async function markAllRead() {
    setUnread(0)
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })))
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {})
  }

  async function clearRead() {
    await fetch("/api/notifications", { method: "DELETE" }).catch(() => {})
    const data = await fetchPage()
    setItems(data.notifications)
    setUnread(data.unreadCount)
    setHasMore(data.notifications.length === PAGE_SIZE)
  }

  async function handleClick(n: NotificationItem) {
    if (!n.readAt) {
      setUnread((u) => Math.max(0, u - 1))
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
      )
      fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      }).catch(() => {})
    }
    if (n.url) router.push(n.url)
  }

  // Client-side filter over already-loaded items only. Does not touch the
  // fetch contract, so "Load more" pagination keeps working unchanged.
  const visibleItems = items.filter((n) => {
    switch (filter) {
      case "alerts":
        return n.category === "security"
      case "billing":
        return n.category === "billing"
      default:
        return true
    }
  })

  return (
    <PageContainer>
      <PageHeader
        title="Notifications"
        description="Alerts, deploys, and billing events across your workspace."
        actions={
          <>
            {unread > 0 && (
              <Button variant="outline" size="sm" onClick={markAllRead}>
                <Check data-icon="inline-start" />
                Mark all read
              </Button>
            )}
            {items.some((n) => n.readAt) && (
              <Button variant="outline" size="sm" onClick={clearRead}>
                <Trash2 data-icon="inline-start" />
                Clear read
              </Button>
            )}
          </>
        }
      />

      {loading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No notifications yet</EmptyTitle>
            <EmptyDescription>
              Deployments, billing events, and security alerts will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? "default" : "outline"}
                className="rounded-full"
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </Button>
            ))}
          </div>

          <Card>
            <CardContent className="divide-y p-0">
              {visibleItems.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No notifications match this filter.
                </p>
              ) : (
                visibleItems.map((n) => {
                  const { Icon, tile } = categoryVisual(n.category, n.type)
                  return (
                    <button
                      key={n.id}
                      onClick={() => handleClick(n)}
                      className={cn(
                        "flex w-full gap-3.5 border-l-2 border-l-transparent px-4 py-3 text-left transition-colors hover:bg-muted/50",
                        !n.readAt && "border-l-primary bg-primary/[0.04]",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-[10px]",
                          tile,
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 font-medium">{n.title}</span>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {formatWhen(n.createdAt)}
                          </span>
                        </div>
                        <span className="text-sm text-muted-foreground">{n.message}</span>
                      </div>
                    </button>
                  )
                })
              )}
            </CardContent>
          </Card>
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </PageContainer>
  )
}
