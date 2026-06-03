"use client"

import { useCallback, useEffect, useState } from "react"
import { Search } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
      return "default"
    case "canceled":
      return "destructive"
    case "past_due":
      return "outline"
    default:
      return "secondary"
  }
}

const tabs = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Canceled", value: "canceled" },
  { label: "Past Due", value: "past_due" },
] as const

interface Sub {
  id: string
  status: string
  interval: string
  currentPeriodEnd: string | null
  createdAt: string
  user: { id: string; name: string | null; email: string }
  plan: { name: string }
  instance?: {
    name: string
    serverConfig: { label: string }
    region: { name: string }
  } | null
}

export default function AdminSubscriptionsPage() {
  const [subs, setSubs] = useState<Sub[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")

  const fetchSubs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set("search", search)
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter)
      const res = await fetch(`/api/admin/subscriptions?${params.toString()}`)
      if (res.ok) setSubs(await res.json())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter])

  useEffect(() => {
    fetchSubs()
  }, [fetchSubs])

  async function handleAction(id: string, action: "cancel" | "activate" | "delete") {
    if (action === "delete") {
      await fetch(`/api/admin/subscriptions/${id}`, { method: "DELETE" })
    } else {
      await fetch(`/api/admin/subscriptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action === "cancel" ? "canceled" : "active" }),
      })
    }
    fetchSubs()
  }

  return (
    <PageContainer>
      <PageHeader title="All Subscriptions" description="Manage every subscription across users." />

      <InputGroup className="max-w-md">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          placeholder="Search by user email or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </InputGroup>

      <ToggleGroup
        multiple={false}
        value={[statusFilter]}
        onValueChange={(v) => {
          const next = v[0]
          if (next) setStatusFilter(next)
        }}
        variant="outline"
        spacing={2}
      >
        {tabs.map((tab) => (
          <ToggleGroupItem key={tab.value} value={tab.value}>
            {tab.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : subs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No subscriptions found</EmptyTitle>
            <EmptyDescription>Try adjusting your search or filters.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-3">
          {subs.map((sub) => (
            <Card key={sub.id}>
              <CardContent className="flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <p className="font-medium text-foreground">{sub.plan.name} Plan</p>
                    <Badge variant={statusBadgeVariant(sub.status)}>{sub.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{sub.user.email}</p>
                  {sub.instance && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {sub.instance.name} &middot; {sub.instance.serverConfig.label}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {sub.status !== "active" && (
                    <Button size="sm" onClick={() => handleAction(sub.id, "activate")}>
                      Activate
                    </Button>
                  )}
                  {sub.status === "active" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAction(sub.id, "cancel")}
                    >
                      Cancel
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button size="sm" variant="destructive">
                          Delete
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this subscription?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the subscription record. This action cannot be
                          undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleAction(sub.id, "delete")}
                          render={<Button variant="destructive">Delete</Button>}
                        />
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
