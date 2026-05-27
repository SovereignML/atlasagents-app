"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

const SELECTED_GLOW =
  "data-[state=on]:border-ring data-[state=on]:ring-1 data-[state=on]:ring-ring data-[state=on]:bg-ring/15 data-[state=on]:text-foreground"

export function CreditAdjustForm() {
  const router = useRouter()
  const [mode, setMode] = useState<"grant" | "remove">("grant")
  const [target, setTarget] = useState("")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(false)

  async function submit() {
    const n = Math.round(Number(amount))
    if (!target.trim()) return toast.error("Enter a user email or ID")
    if (!Number.isFinite(n) || n <= 0) return toast.error("Enter a positive credit amount")
    if (reason.trim().length < 3) return toast.error("Enter a reason (3+ chars)")

    const credits = mode === "remove" ? -n : n
    // An '@' means it's an email; otherwise treat it as a user id.
    const body = target.includes("@")
      ? { email: target.trim(), credits, reason: reason.trim() }
      : { userId: target.trim(), credits, reason: reason.trim() }

    setLoading(true)
    try {
      const res = await fetch("/api/admin/billing/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as {
        ok?: boolean
        balance?: number
        shortfall?: number
        error?: string
      }
      if (!res.ok || !data.ok) {
        toast.error(data.error || "Adjustment failed")
        return
      }
      toast.success(
        `Done. New balance: ${(data.balance ?? 0).toLocaleString()} cr` +
          (data.shortfall ? ` (short by ${data.shortfall.toLocaleString()} cr)` : ""),
      )
      setAmount("")
      setReason("")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <ToggleGroup
          value={[mode]}
          onValueChange={(v) => v[0] && setMode(v[0] as "grant" | "remove")}
          className="grid grid-cols-2 gap-2"
          spacing={1}
        >
          <ToggleGroupItem value="grant" variant="outline" className={cn("h-9", SELECTED_GLOW)}>
            Grant
          </ToggleGroupItem>
          <ToggleGroupItem value="remove" variant="outline" className={cn("h-9", SELECTED_GLOW)}>
            Remove
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="adj-target">User email or ID</Label>
            <Input
              id="adj-target"
              placeholder="user@example.com"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adj-amount">Credits ({mode === "remove" ? "to remove" : "to grant"})</Label>
            <Input
              id="adj-amount"
              type="number"
              min={1}
              placeholder="1000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="adj-reason">Reason</Label>
          <Textarea
            id="adj-reason"
            placeholder="Goodwill credit for support ticket #123"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />
        </div>

        <Button onClick={submit} disabled={loading} variant={mode === "remove" ? "destructive" : "default"}>
          {loading && <Loader2 data-icon="inline-start" className="animate-spin" />}
          {mode === "remove" ? "Remove credits" : "Grant credits"}
        </Button>
      </CardContent>
    </Card>
  )
}

export function RunReconcileButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function run() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/billing/health?full=1")
      const data = (await res.json()) as {
        ledgerMismatches?: unknown[]
        usageDrift?: unknown[]
        keysPolled?: number
        alertsCreated?: number
        error?: string
      }
      if (!res.ok) {
        toast.error(data.error || "Reconcile failed")
        return
      }
      toast.success(
        `Reconciled: ${data.keysPolled ?? 0} keys polled, ` +
          `${data.ledgerMismatches?.length ?? 0} ledger + ${data.usageDrift?.length ?? 0} usage issue(s), ` +
          `${data.alertsCreated ?? 0} alert(s) raised.`,
      )
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={loading}>
      {loading ? (
        <Loader2 data-icon="inline-start" className="animate-spin" />
      ) : (
        <RefreshCw data-icon="inline-start" />
      )}
      Run full reconcile
    </Button>
  )
}
