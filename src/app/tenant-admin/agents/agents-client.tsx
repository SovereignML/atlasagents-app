"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type AgentRow = {
  id: string
  name: string
  status: string
  customer: string
  ownerUserId: string
  ownerEmail: string
  ownerName: string | null
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "running") return "default"
  if (status === "failed" || status === "failed_provisioning") return "destructive"
  if (status === "provisioning" || status === "pending") return "outline"
  return "secondary"
}

export function AgentsClient({ agents }: { agents: AgentRow[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function impersonate(userId: string) {
    setError(null)
    const res = await fetch("/api/tenant-admin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || "Could not start impersonation")
      return
    }
    startTransition(() => router.push("/dashboard"))
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  No agents across your customers yet.
                </TableCell>
              </TableRow>
            ) : (
              agents.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>{a.customer}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {a.ownerName || a.ownerEmail}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(a.status)}>{a.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => impersonate(a.ownerUserId)}
                    >
                      Manage as customer
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
