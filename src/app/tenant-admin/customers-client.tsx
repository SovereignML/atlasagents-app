"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type Customer = {
  id: string
  name: string
  suspended: boolean
  agentLimit: number | null
  seatLimit: number
  agents: number
  members: number
  createdAt: string
}

export function CustomersClient({ customers }: { customers: Customer[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")

  async function call(url: string, init: RequestInit) {
    setError(null)
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || "Something went wrong")
      return false
    }
    return true
  }

  function refresh() {
    startTransition(() => router.refresh())
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (await call("/api/tenant-admin/customers", { method: "POST", body: JSON.stringify({ name, ownerEmail }) })) {
      setName("")
      setOwnerEmail("")
      refresh()
    }
  }

  async function setSuspended(c: Customer, suspended: boolean) {
    if (await call(`/api/tenant-admin/customers/${c.id}`, { method: "PATCH", body: JSON.stringify({ suspended }) })) {
      refresh()
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="p-4">
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <Field className="flex-1 min-w-[180px]">
            <FieldLabel htmlFor="cust-name">Customer name</FieldLabel>
            <Input id="cust-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" required />
          </Field>
          <Field className="flex-1 min-w-[220px]">
            <FieldLabel htmlFor="cust-email">Owner email (existing account)</FieldLabel>
            <Input id="cust-email" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@acme.com" required />
          </Field>
          <Button type="submit" variant="gradient" size="pill" disabled={pending}>
            <Plus className="mr-1 h-4 w-4" />
            Add customer
          </Button>
        </form>
      </Card>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Agents</TableHead>
              <TableHead>Members</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  No customers yet. They appear here when they sign up on your domain, or add one above.
                </TableCell>
              </TableRow>
            ) : (
              customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    {c.suspended ? (
                      <Badge variant="destructive">Suspended</Badge>
                    ) : (
                      <Badge variant="default">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">
                    {c.agents}
                    {c.agentLimit != null ? ` / ${c.agentLimit}` : ""}
                  </TableCell>
                  <TableCell className="font-mono">
                    {c.members} / {c.seatLimit}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.suspended ? (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => setSuspended(c, false)}>
                        Unsuspend
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => setSuspended(c, true)}>
                        Suspend
                      </Button>
                    )}
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
