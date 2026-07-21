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
  seatLimit: number | null
  agents: number
  members: number
  createdAt: string
}

type PlanOption = {
  id: string
  name: string
  priceCents: number | null
  interval: string
  active: boolean
}

export function CustomersClient({ customers }: { customers: Customer[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [ownerName, setOwnerName] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [billFor, setBillFor] = useState<Customer | null>(null)
  const [plans, setPlans] = useState<PlanOption[]>([])

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
    if (
      await call("/api/tenant-admin/customers", {
        method: "POST",
        body: JSON.stringify({ name, ownerName: ownerName || undefined, ownerEmail }),
      })
    ) {
      setName("")
      setOwnerName("")
      setOwnerEmail("")
      refresh()
    }
  }

  async function setSuspended(c: Customer, suspended: boolean) {
    if (await call(`/api/tenant-admin/customers/${c.id}`, { method: "PATCH", body: JSON.stringify({ suspended }) })) {
      refresh()
    }
  }

  // "Act as customer": drop into the child team's full dashboard. On success the
  // act-as cookie is set server-side; navigating to /dashboard renders it.
  async function manageAs(c: Customer) {
    if (
      await call("/api/tenant-admin/act-as", {
        method: "POST",
        body: JSON.stringify({ childTeamId: c.id }),
      })
    ) {
      window.location.assign("/dashboard")
    }
  }

  // Billing: fetch the tenant's active plans, then offer a Connect checkout link
  // for this customer (paid to the tenant's own Stripe).
  async function openBilling(c: Customer) {
    setError(null)
    const res = await fetch("/api/tenant-admin/plans")
    if (!res.ok) {
      setError("Could not load plans")
      return
    }
    const { plans: all } = (await res.json()) as { plans: PlanOption[] }
    const active = all.filter((p) => p.active)
    if (active.length === 0) {
      setError("Create a plan first in Branding & Settings → Plans.")
      return
    }
    setPlans(active)
    setBillFor(c)
  }

  async function checkout(planId: string) {
    if (!billFor) return
    setError(null)
    const res = await fetch(`/api/tenant-admin/customers/${billFor.id}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantPlanId: planId }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || "Could not start checkout")
      return
    }
    const { url } = (await res.json()) as { url: string | null }
    setBillFor(null)
    if (url) window.open(url, "_blank")
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {billFor && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">
              Choose a plan for <span className="font-semibold">{billFor.name}</span>
            </p>
            <Button size="sm" variant="ghost" onClick={() => setBillFor(null)}>
              Cancel
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {plans.map((p) => (
              <Button key={p.id} size="sm" variant="outline" onClick={() => checkout(p.id)}>
                {p.name}
                {p.priceCents != null && (
                  <span className="ml-1 text-muted-foreground">
                    ${(p.priceCents / 100).toFixed(0)}/{p.interval === "year" ? "yr" : "mo"}
                  </span>
                )}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Opens a Stripe checkout link (paid to your own Stripe). Share it with the customer.
          </p>
        </Card>
      )}

      <Card className="p-4">
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <Field className="flex-1 min-w-[160px]">
            <FieldLabel htmlFor="cust-name">Customer name</FieldLabel>
            <Input id="cust-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" required />
          </Field>
          <Field className="flex-1 min-w-[160px]">
            <FieldLabel htmlFor="cust-owner-name">Owner name</FieldLabel>
            <Input id="cust-owner-name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field className="flex-1 min-w-[200px]">
            <FieldLabel htmlFor="cust-email">Owner email (new account)</FieldLabel>
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
                    {c.members} / {c.seatLimit ?? "Plan"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {!c.suspended && (
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => openBilling(c)}>
                          Bill
                        </Button>
                      )}
                      {!c.suspended && (
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => manageAs(c)}>
                          Manage as
                        </Button>
                      )}
                      {c.suspended ? (
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => setSuspended(c, false)}>
                          Unsuspend
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => setSuspended(c, true)}>
                          Suspend
                        </Button>
                      )}
                    </div>
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
