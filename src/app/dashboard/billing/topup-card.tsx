"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Plus, Zap } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

const PRESETS = [
  { credits: 500, label: "$5", subtitle: "500 credits" },
  { credits: 2_000, label: "$20", subtitle: "2,000 credits" },
  { credits: 5_000, label: "$50", subtitle: "5,000 credits" },
  { credits: 10_000, label: "$100", subtitle: "10,000 credits" },
] as const

const SELECTED_GLOW =
  "data-[state=on]:border-ring data-[state=on]:ring-1 data-[state=on]:ring-ring data-[state=on]:bg-ring/15 data-[state=on]:text-foreground"

export function TopUpCard({ stripeConfigured }: { stripeConfigured: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [credits, setCredits] = useState<number>(2_000)
  const [loading, setLoading] = useState(false)
  const confirmedTopup = useRef(false)

  // On return from Stripe Checkout (?topup=success) confirm the payment. The
  // webhook credits the wallet asynchronously, so refresh and let the user know
  // the balance is on its way. Strip the param so it can't re-fire on refresh.
  useEffect(() => {
    if (confirmedTopup.current) return
    if (searchParams.get("topup") !== "success") return
    confirmedTopup.current = true
    toast.success("Payment received — credits will appear in a few seconds.")
    router.refresh()
    router.replace("/dashboard/billing")
  }, [searchParams, router])

  async function buyCredits() {
    setLoading(true)
    try {
      const res = await fetch("/api/billing/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits }),
      })
      const data = (await res.json()) as {
        credits?: number
        checkoutUrl?: string
        devMode?: boolean
        error?: string
      }
      if (!res.ok) {
        toast.error(data.error || "Top-up failed")
        return
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return
      }
      toast.success(
        `Added ${credits.toLocaleString()} credits to your balance.${data.devMode ? " (dev mode)" : ""}`,
      )
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] tracking-[0.1em] uppercase text-primary">
          Top up
        </CardDescription>
        <CardTitle className="text-base">Add credits</CardTitle>
        <p className="text-xs text-muted-foreground">
          1 credit = $0.01. Credits never expire and apply to compute + API usage.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ToggleGroup
          value={[String(credits)]}
          onValueChange={(v) => v[0] && setCredits(Number(v[0]))}
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          spacing={1}
        >
          {PRESETS.map((p) => (
            <ToggleGroupItem
              key={p.credits}
              value={String(p.credits)}
              variant="outline"
              className={cn(
                "h-auto flex-col items-start gap-0.5 whitespace-normal p-3 text-left",
                SELECTED_GLOW,
              )}
            >
              <p className="text-base font-semibold text-foreground">{p.label}</p>
              <p className="text-[11px] text-muted-foreground">{p.subtitle}</p>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <Button
          variant="gradient"
          size="pill"
          onClick={buyCredits}
          disabled={loading}
          className="w-full"
        >
          {loading ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : stripeConfigured ? (
            <Zap data-icon="inline-start" />
          ) : (
            <Plus data-icon="inline-start" />
          )}
          {loading
            ? "Processing…"
            : stripeConfigured
              ? `Buy ${credits.toLocaleString()} credits`
              : `Grant ${credits.toLocaleString()} credits (dev)`}
        </Button>

        {!stripeConfigured && (
          <p className="text-[11px] text-muted-foreground">
            Stripe is not configured — top-ups are credited instantly for development.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
