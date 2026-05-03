import { auth } from "@/auth"
import { db, eq, desc, subscriptions } from "@/db"
import { redirect } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { BillingPortalButton } from "./portal-button"
import { findPlanBySlug } from "@/configs/plans"

const STATUS_STYLES: Record<string, string> = {
  active: "bg-[var(--accent-dim)] text-[var(--accent-color)] border-[var(--accent-color)]/30",
  past_due: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  canceled: "bg-red-500/10 text-red-400 border-red-500/30",
  incomplete: "bg-[var(--card-bg)] text-[var(--text-secondary)] border-[var(--border-color)]",
}

export default async function BillingPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const rows = await db.query.subscriptions.findMany({
    where: eq(subscriptions.userId, session.user.id),
    with: {
      plan: true,
      instance: { with: { serverConfig: true, region: true } },
    },
    orderBy: desc(subscriptions.createdAt),
  })

  const totalMonthly = rows
    .filter((s) => s.status === "active" && s.instance && s.instance.status !== "deleted")
    .reduce((sum, s) => {
      const cfg = findPlanBySlug(s.plan?.slug ?? "")
      if (!cfg) return sum
      return sum + (s.interval === "year"
        ? cfg.displayPriceYearly / 12
        : cfg.displayPriceMonthly)
    }, 0)

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1
          className="text-2xl font-bold uppercase tracking-[0.02em] text-[var(--text-primary)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Billing
        </h1>
        <p className="text-[var(--text-secondary)] mt-1 text-sm">Your subscriptions and billing overview</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
          <p className="text-xs text-[var(--text-secondary)] uppercase tracking-[0.1em]" style={{ fontFamily: "var(--font-mono)" }}>
            Estimated Monthly Cost
          </p>
          <p className="text-3xl font-bold mt-2 text-[var(--text-primary)]" style={{ fontFamily: "var(--font-display)" }}>
            ${totalMonthly.toFixed(2)}<span className="text-[var(--text-secondary)] text-lg font-normal">/mo</span>
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
          <p className="text-xs text-[var(--text-secondary)] uppercase tracking-[0.1em]" style={{ fontFamily: "var(--font-mono)" }}>
            Active Subscriptions
          </p>
          <p className="text-3xl font-bold mt-2 text-[var(--accent-color)]" style={{ fontFamily: "var(--font-display)" }}>
            {rows.filter(s => s.status === "active").length}
          </p>
        </div>
      </div>

      <div>
        <h2
          className="text-lg font-bold uppercase tracking-[0.02em] text-[var(--text-primary)] mb-4"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Subscriptions
        </h2>
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-8 text-center">
            <p className="text-[var(--text-secondary)]">No subscriptions yet. Deploy an instance to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((sub) => (
              <div key={sub.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-[var(--text-primary)] font-medium">{sub.plan.name} Plan</h3>
                      <Badge className={STATUS_STYLES[sub.status] || STATUS_STYLES.incomplete}>
                        {sub.status}
                      </Badge>
                    </div>
                    {sub.instance && sub.instance.status === "deleted" && (
                      <p className="text-sm text-[var(--text-secondary)] mt-1">Agent removed (deleted)</p>
                    )}
                    {sub.instance && sub.instance.status !== "deleted" && (
                      <p className="text-sm text-[var(--text-secondary)] mt-1">
                        {sub.instance.name} &middot; {sub.instance.region.name} &middot; {sub.instance.serverConfig.label}
                      </p>
                    )}
                    <p className="text-xs text-[var(--text-secondary)] mt-1" style={{ fontFamily: "var(--font-mono)" }}>
                      Billing: {sub.interval === "year" ? "Yearly" : "Monthly"}
                      {sub.currentPeriodEnd && (
                        <> &middot; Renews {sub.currentPeriodEnd.toISOString().slice(0, 10)}</>
                      )}
                    </p>
                  </div>
                  {(() => {
                    const cfg = findPlanBySlug(sub.plan?.slug ?? "")
                    if (!cfg) return null
                    const price = sub.interval === "year"
                      ? cfg.displayPriceYearly
                      : cfg.displayPriceMonthly
                    return (
                      <div className="text-right">
                        <p className="text-[var(--text-primary)] font-bold" style={{ fontFamily: "var(--font-display)" }}>
                          {price === 0 ? "Free" : `$${price.toFixed(2)}`}
                          {price > 0 && (
                            <span className="text-[var(--text-secondary)] text-sm font-normal">
                              /{sub.interval === "year" ? "yr" : "mo"}
                            </span>
                          )}
                        </p>
                      </div>
                    )
                  })()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="max-w-md">
        <BillingPortalButton />
      </div>
    </div>
  )
}
