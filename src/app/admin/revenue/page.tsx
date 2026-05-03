import { db, eq, subscriptions, instances } from "@/db"

export default async function AdminRevenuePage() {
  const [activeSubs, runningInstances] = await Promise.all([
    db.query.subscriptions.findMany({
      where: eq(subscriptions.status, "active"),
      with: { plan: true, instance: { with: { serverConfig: true } } },
    }),
    db.query.instances.findMany({
      where: eq(instances.status, "running"),
      with: { serverConfig: true },
    }),
  ])

  const monthlyRecurring = runningInstances.reduce((sum, inst) => {
    if (inst.billingInterval === "year") {
      return sum + inst.serverConfig.priceYearly / 12
    }
    return sum + inst.serverConfig.priceMonthly
  }, 0)

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Revenue</h1>
        <p className="text-zinc-400 mt-1">Estimated recurring revenue from active instances.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <p className="text-sm text-zinc-400">Est. MRR</p>
          <p className="text-3xl font-bold mt-1 text-emerald-400">${monthlyRecurring.toFixed(2)}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <p className="text-sm text-zinc-400">Active Subscriptions</p>
          <p className="text-3xl font-bold mt-1 text-blue-400">{activeSubs.length}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <p className="text-sm text-zinc-400">Running Instances</p>
          <p className="text-3xl font-bold mt-1 text-violet-400">{runningInstances.length}</p>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Active Instance Revenue</h2>
        {runningInstances.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center">
            <p className="text-zinc-400">No running instances.</p>
          </div>
        ) : (
          <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-zinc-400 font-medium py-3 px-4">Instance</th>
                  <th className="text-left text-zinc-400 font-medium py-3 px-4">Server</th>
                  <th className="text-center text-zinc-400 font-medium py-3 px-4">Billing</th>
                  <th className="text-right text-zinc-400 font-medium py-3 px-4">Monthly Equiv.</th>
                </tr>
              </thead>
              <tbody>
                {runningInstances.map((inst) => {
                  const monthly = inst.billingInterval === "year"
                    ? inst.serverConfig.priceYearly / 12
                    : inst.serverConfig.priceMonthly
                  return (
                    <tr key={inst.id} className="border-b border-white/5">
                      <td className="py-3 px-4">
                        <p className="text-white font-medium">{inst.name}</p>
                        <p className="text-xs text-zinc-500 font-mono">{inst.slug}</p>
                      </td>
                      <td className="py-3 px-4 text-zinc-300">{inst.serverConfig.label}</td>
                      <td className="py-3 px-4 text-center text-zinc-300 capitalize">{inst.billingInterval === "year" ? "Yearly" : "Monthly"}</td>
                      <td className="py-3 px-4 text-right text-white font-medium">${monthly.toFixed(2)}/mo</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
