"use client"

import { useCallback, useEffect, useState } from "react"
import { Check } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface Notification {
  id: string
  type: string
  message: string
  resolved: boolean
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
  user: { id: string; name: string | null; email: string }
}

const typeConfig: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
  invoice_needed: { label: "Invoice Needed", variant: "outline" },
  low_balance: { label: "Low Balance", variant: "destructive" },
  instance_stopped: { label: "Instance Stopped", variant: "destructive" },
}

export default function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<string | null>(null)
  const [tab, setTab] = useState("pending")

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (tab === "resolved") params.set("resolved", "true")
    const res = await fetch(`/api/admin/notifications?${params}`)
    if (res.ok) {
      const data = await res.json()
      setNotifications(data)
    }
    setLoading(false)
  }, [tab])

  useEffect(() => {
    // Fetch-on-mount/tab-change: fetchNotifications flips loading state
    // synchronously, which is the intended behavior for a data-loading effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchNotifications()
  }, [fetchNotifications])

  async function handleResolve(id: string) {
    setResolving(id)
    await fetch("/api/admin/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    await fetchNotifications()
    setResolving(null)
  }

  return (
    <PageContainer>
      <PageHeader
        title="Billing Notifications"
        description="Alerts for low wallet balances, stopped instances, and invoicing needs."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : notifications.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Empty>
                        <EmptyHeader>
                          <EmptyTitle>
                            {tab === "pending" ? "No pending notifications" : "No resolved notifications"}
                          </EmptyTitle>
                          <EmptyDescription>
                            {tab === "pending"
                              ? "All billing notifications have been addressed."
                              : "No notifications have been resolved yet."}
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </TableCell>
                  </TableRow>
                ) : (
                  notifications.map((n) => {
                    const cfg = typeConfig[n.type] ?? { label: n.type, variant: "secondary" as const }
                    return (
                      <TableRow key={n.id}>
                        <TableCell>
                          <Badge variant={cfg.variant}>{cfg.label}</Badge>
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium text-foreground">
                              {n.user.name || "—"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {n.user.email}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-md whitespace-normal text-sm text-muted-foreground">
                          {n.message}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(n.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell>
                          {n.resolved ? (
                            <Badge variant="secondary">
                              <Check className="mr-1 size-3" />
                              Resolved
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={resolving === n.id}
                              onClick={() => handleResolve(n.id)}
                            >
                              <Check className="mr-1 size-3" />
                              {resolving === n.id ? "Resolving..." : "Mark Resolved"}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
