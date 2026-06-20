"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Check, X } from "lucide-react"

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

interface DeletionRequestRow {
  id: string
  reason: string | null
  status: "pending" | "approved" | "denied"
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
  user: { id: string; name: string | null; email: string }
}

const statusBadge: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
  pending: { label: "Pending", variant: "outline" },
  approved: { label: "Approved", variant: "secondary" },
  denied: { label: "Denied", variant: "destructive" },
}

export default function AdminDeletionRequestsPage() {
  const [requests, setRequests] = useState<DeletionRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [tab, setTab] = useState("pending")

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/deletion-requests?status=${tab}`)
    if (res.ok) setRequests(await res.json())
    setLoading(false)
  }, [tab])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRequests()
  }, [fetchRequests])

  async function handleDecision(id: string, action: "approve" | "deny") {
    const note =
      action === "deny" ? window.prompt("Reason for declining (shown to the user, optional):") ?? undefined : undefined
    setActing(id)
    await fetch("/api/admin/deletion-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, note }),
    })
    await fetchRequests()
    setActing(null)
  }

  return (
    <PageContainer>
      <PageHeader
        title="Deletion Requests"
        description="Account deletion requests submitted by users. Approving records the decision and emails the user. Perform the actual deletion from the Users page."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="denied">Denied</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested</TableHead>
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
                ) : requests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Empty>
                        <EmptyHeader>
                          <EmptyTitle>No {tab} requests</EmptyTitle>
                          <EmptyDescription>
                            {tab === "pending"
                              ? "No account deletion requests are awaiting review."
                              : `No ${tab} deletion requests.`}
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </TableCell>
                  </TableRow>
                ) : (
                  requests.map((r) => {
                    const cfg = statusBadge[r.status]
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium text-foreground">{r.user.name || "-"}</div>
                          <div className="text-xs text-muted-foreground">{r.user.email}</div>
                        </TableCell>
                        <TableCell className="max-w-xs whitespace-normal text-sm text-muted-foreground">
                          {r.reason || <span className="italic">No reason given</span>}
                          {r.decisionNote ? (
                            <div className="mt-1 text-xs">Note: {r.decisionNote}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant={cfg.variant}>{cfg.label}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(r.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell>
                          {r.status === "pending" ? (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={acting === r.id}
                                onClick={() => handleDecision(r.id, "approve")}
                              >
                                <Check className="mr-1 size-3" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={acting === r.id}
                                onClick={() => handleDecision(r.id, "deny")}
                              >
                                <X className="mr-1 size-3" />
                                Deny
                              </Button>
                            </div>
                          ) : r.status === "approved" ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              render={<Link href="/admin/users">Delete in Users</Link>}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
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
