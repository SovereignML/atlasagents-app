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

export type TenantPlan = {
  id: string
  name: string
  priceCents: number | null
  interval: string
  agentLimit: number | null
  seatLimit: number | null
  active: boolean
}

export function PlansClient({
  plans,
  connected,
}: {
  plans: TenantPlan[]
  connected: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [price, setPrice] = useState("")
  const [interval, setInterval] = useState<"month" | "year">("month")
  const [agentLimit, setAgentLimit] = useState("")
  const [seatLimit, setSeatLimit] = useState("")

  function refresh() {
    startTransition(() => router.refresh())
  }

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

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const amountCents = Math.round(parseFloat(price) * 100)
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError("Enter a valid price")
      return
    }
    const ok = await call("/api/tenant-admin/plans", {
      method: "POST",
      body: JSON.stringify({
        name,
        amountCents,
        interval,
        agentLimit: agentLimit ? Number(agentLimit) : undefined,
        seatLimit: seatLimit ? Number(seatLimit) : undefined,
      }),
    })
    if (ok) {
      setName("")
      setPrice("")
      setAgentLimit("")
      setSeatLimit("")
      refresh()
    }
  }

  async function archive(id: string) {
    if (await call("/api/tenant-admin/plans", { method: "PATCH", body: JSON.stringify({ planId: id }) })) {
      refresh()
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!connected && (
        <Alert>
          <AlertDescription>
            Connect your Stripe account above before creating plans.
          </AlertDescription>
        </Alert>
      )}

      <Card className="p-4">
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <Field className="flex-1 min-w-[140px]">
            <FieldLabel htmlFor="plan-name">Plan name</FieldLabel>
            <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pro" required />
          </Field>
          <Field className="min-w-[110px]">
            <FieldLabel htmlFor="plan-price">Price (USD)</FieldLabel>
            <Input id="plan-price" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="49" required />
          </Field>
          <Field className="min-w-[110px]">
            <FieldLabel htmlFor="plan-interval">Interval</FieldLabel>
            <select
              id="plan-interval"
              value={interval}
              onChange={(e) => setInterval(e.target.value as "month" | "year")}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="month">Monthly</option>
              <option value="year">Yearly</option>
            </select>
          </Field>
          <Field className="min-w-[100px]">
            <FieldLabel htmlFor="plan-agents">Agent cap</FieldLabel>
            <Input id="plan-agents" type="number" min="1" value={agentLimit} onChange={(e) => setAgentLimit(e.target.value)} placeholder="—" />
          </Field>
          <Field className="min-w-[100px]">
            <FieldLabel htmlFor="plan-seats">Seat cap</FieldLabel>
            <Input id="plan-seats" type="number" min="1" value={seatLimit} onChange={(e) => setSeatLimit(e.target.value)} placeholder="—" />
          </Field>
          <Button type="submit" variant="gradient" size="pill" disabled={pending || !connected}>
            <Plus className="mr-1 h-4 w-4" />
            Add plan
          </Button>
        </form>
      </Card>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plan</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Caps</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  No plans yet. Add one above to let customers subscribe.
                </TableCell>
              </TableRow>
            ) : (
              plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="font-mono">
                    {p.priceCents != null ? `$${(p.priceCents / 100).toFixed(2)}` : "—"}/{p.interval === "year" ? "yr" : "mo"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.agentLimit ?? "∞"} agents · {p.seatLimit ?? "∞"} seats
                  </TableCell>
                  <TableCell>
                    {p.active ? <Badge variant="default">Active</Badge> : <Badge variant="secondary">Archived</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.active && (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => archive(p.id)}>
                        Archive
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
