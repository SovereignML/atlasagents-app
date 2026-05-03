import { auth } from "@/auth"
import { db, eq, desc, subscriptions } from "@/db"
import { redirect } from "next/navigation"
import { Badge } from "@/components/ui/badge"

const statusStyles: Record<string, string> = {
  active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  past_due: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  canceled: "bg-red-500/20 text-red-400 border-red-500/30",
  incomplete: "bg-zinc-500/20 text-[var(--text-secondary)] border-zinc-500/30",
}

export default async function SubscriptionsPage() {
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

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Subscriptions</h1>
        <p className="text-[var(--text-secondary)] mt-1">Your active and past subscriptions</p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-12 text-center">
          <p className="text-[var(--text-secondary)]">No subscriptions yet. Deploy an instance to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((sub) => (
            <div
              key={sub.id}
              className="bg-[var(--card-bg)] backdrop-blur-xl border border-[var(--border-color)] rounded-2xl p-6 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-[var(--text-primary)]">{sub.plan.name} Plan</h3>
                    <Badge className={statusStyles[sub.status] || statusStyles.incomplete}>
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
                </div>
                {sub.instance && sub.instance.status !== "deleted" && (
                  <div className="text-right">
                    <p className="text-[var(--text-primary)] font-semibold">
                      ${sub.interval === "year"
                        ? sub.instance.serverConfig.priceYearly.toFixed(2)
                        : sub.instance.serverConfig.priceMonthly.toFixed(2)}
                      <span className="text-[var(--text-secondary)] text-sm font-normal">
                        /{sub.interval === "year" ? "yr" : "mo"}
                      </span>
                    </p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-[var(--text-secondary)]">Billing</p>
                  <p className="text-[var(--text-primary)] capitalize">{sub.interval === "year" ? "Yearly" : "Monthly"}</p>
                </div>
                {sub.currentPeriodEnd && (
                  <div>
                    <p className="text-[var(--text-secondary)]">Renews</p>
                    <p className="text-[var(--text-primary)]">{sub.currentPeriodEnd.toISOString().slice(0, 10)}</p>
                  </div>
                )}
                <div>
                  <p className="text-[var(--text-secondary)]">Created</p>
                  <p className="text-[var(--text-primary)]">{sub.createdAt.toISOString().slice(0, 10)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
