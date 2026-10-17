"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type PlanRowData = {
  subscriptionId: string
  interval: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  /** Paid up — false while Stripe is retrying a failed payment. */
  allowsInstall: boolean
  /** The agent this plan covers, or null while it is available. */
  agent: { id: string; name: string } | null
  /** Set on a grandfathered per-server plan, which covers a whole server. */
  serverLabel: string | null
}

function statusLine(plan: PlanRowData): string {
  const date = plan.currentPeriodEnd ? plan.currentPeriodEnd.slice(0, 10) : null
  const billed = plan.interval === "year" ? "Yearly" : "Monthly"
  if (!plan.allowsInstall) return `${billed} · payment failed — update your card in Billing`
  if (plan.cancelAtPeriodEnd) return `${billed} · ends ${date ?? "at period end"}`
  return `${billed}${date ? ` · renews ${date}` : ""}`
}

/**
 * The customer's BYOS plans, one row per plan. Each plan covers one agent, or
 * is available for the next install. Cancelling takes effect at the end of the paid
 * period, and can be undone until then.
 */
export function PlanList({ plans }: { plans: PlanRowData[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function setCancel(plan: PlanRowData, cancelAtPeriodEnd: boolean) {
    setBusyId(plan.subscriptionId)
    try {
      const res = await fetch(`/api/byos/plans/${plan.subscriptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelAtPeriodEnd }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Couldn't update the plan (${res.status})`)
      toast.success(
        cancelAtPeriodEnd
          ? plan.agent
            ? `Plan canceled. ${plan.agent.name} keeps running until the period ends.`
            : "Plan canceled. It ends with the period you paid for."
          : "Plan will renew.",
      )
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the plan")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
      {plans.map((plan) => {
        const busy = busyId === plan.subscriptionId
        return (
          <li
            key={plan.subscriptionId}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {plan.serverLabel ? (
                  <>Server plan · every agent on {plan.serverLabel}</>
                ) : plan.agent ? (
                  <Link href={`/dashboard/instances/${plan.agent.id}`} className="hover:underline">
                    {plan.agent.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Available — ready for your next agent</span>
                )}
              </p>
              <p
                className={cn(
                  "mt-0.5 text-xs text-muted-foreground",
                  !plan.allowsInstall && "text-destructive",
                )}
              >
                {statusLine(plan)}
              </p>
            </div>
            <Button
              size="sm"
              variant={plan.cancelAtPeriodEnd ? "outline" : "ghost"}
              disabled={busy}
              onClick={() => setCancel(plan, !plan.cancelAtPeriodEnd)}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {plan.cancelAtPeriodEnd ? "Keep plan" : "Cancel plan"}
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
