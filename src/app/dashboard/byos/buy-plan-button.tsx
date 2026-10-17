"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatUsd } from "@/configs/plans"

type Interval = "month" | "year"

/**
 * Buy one BYOS plan — the right to run one agent on a server you own. No
 * server needed: the plan stays free until an install takes it.
 */
export function BuyPlanButton({
  priceMonthly,
  priceYearly,
  disabled,
}: {
  priceMonthly: number
  priceYearly: number
  disabled?: boolean
}) {
  const router = useRouter()
  const [interval, setInterval] = useState<Interval>("month")
  const [busy, setBusy] = useState(false)

  async function buy() {
    setBusy(true)
    try {
      const res = await fetch("/api/byos/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Couldn't start checkout (${res.status})`)
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return
      }
      toast.success("BYOS plan active")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start checkout")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        value={[interval]}
        onValueChange={(v) => v[0] && setInterval(v[0] as Interval)}
        variant="outline"
        size="sm"
        aria-label="Billing interval"
      >
        <ToggleGroupItem value="month">{formatUsd(priceMonthly)}/mo</ToggleGroupItem>
        <ToggleGroupItem value="year">{formatUsd(priceYearly)}/yr</ToggleGroupItem>
      </ToggleGroup>
      <Button size="sm" variant="gradient" onClick={buy} disabled={disabled || busy}>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Buy plan
      </Button>
    </div>
  )
}
