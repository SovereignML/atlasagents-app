"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Skeleton } from "@/components/ui/skeleton"
import { CATEGORY_LABELS, type NotificationCategory } from "@/lib/notifications/types"
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

export default function NotificationsPage() {
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [unread, setUnread] = useState(0)

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

  return (
    <PageContainer>
      <PageHeader
        title="Notifications"
        description="Your alerts across all channels"
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
          <Card>
            <CardContent className="divide-y p-0">
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={cn(
                    "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                    !n.readAt && "bg-muted/30",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {!n.readAt && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                    <span className="flex-1 font-medium">{n.title}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {CATEGORY_LABELS[n.category as NotificationCategory] ?? n.category}
                    </Badge>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatWhen(n.createdAt)}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground">{n.message}</span>
                </button>
              ))}
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
