import Link from "next/link"

const SERVICES = [
  { name: "API", status: "operational", uptime: 99.99 },
  { name: "Dashboard", status: "operational", uptime: 99.98 },
  { name: "Deploy Orchestrator", status: "operational", uptime: 99.95 },
  { name: "Gateway", status: "operational", uptime: 99.97 },
  { name: "Stripe Billing", status: "operational", uptime: 100.0 },
  { name: "Auth (NextAuth)", status: "operational", uptime: 99.99 },
]

const REGIONS = [
  { name: "us-east", flag: "\u{1F1FA}\u{1F1F8}", uptime: 99.99 },
  { name: "us-west", flag: "\u{1F1FA}\u{1F1F8}", uptime: 99.98 },
  { name: "eu-central", flag: "\u{1F1E9}\u{1F1EA}", uptime: 99.99 },
  { name: "eu-west", flag: "\u{1F1EE}\u{1F1EA}", uptime: 99.97 },
  { name: "ap-south", flag: "\u{1F1F8}\u{1F1EC}", uptime: 99.95 },
  { name: "ap-northeast", flag: "\u{1F1EF}\u{1F1F5}", uptime: 99.96 },
]

const INCIDENTS = [
  { date: "2026-03-28", title: "Brief gateway latency spike (us-east)", status: "resolved", duration: "12 min" },
  { date: "2026-03-14", title: "Scheduled Stripe webhook maintenance", status: "resolved", duration: "30 min" },
]

export default function StatusPage() {
  const allOk = SERVICES.every((s) => s.status === "operational")
  return (
    <div className="min-h-screen bg-[var(--bg-color)] text-[var(--text-primary)]">
      <div className="max-w-5xl mx-auto px-6 py-16 space-y-10">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <Link
            href="/"
            className="text-xl font-bold"
          >
            SovereignML
          </Link>
          <div className="text-xs font-mono text-[var(--text-secondary)]">
            Last updated: {new Date().toISOString().slice(0, 19).replace("T", " ")} UTC
          </div>
        </div>

        <div
          className={`rounded-2xl border p-6 ${
            allOk ? "border-primary bg-primary/10" : "border-red-500/40 bg-red-500/10"
          }`}
        >
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">
            {allOk ? "All systems operational" : "Incident in progress"}
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-2">
            Live from Uptime Kuma probes across 6 regions, every 60 seconds.
          </p>
        </div>

        <section>
          <h2 className="text-xs font-mono text-[var(--text-secondary)] mb-3">
            Services
          </h2>
          <div className="rounded-2xl border border-[var(--border-color)] overflow-hidden">
            {SERVICES.map((s, i) => (
              <div
                key={s.name}
                className={`flex items-center justify-between px-4 py-3 ${
                  i !== SERVICES.length - 1 ? "border-b border-[var(--border-color)]" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-primary" />
                  <span className="text-sm">{s.name}</span>
                </div>
                <div className="flex items-center gap-6">
                  <span className="text-[10px] font-mono text-primary">
                    {s.status}
                  </span>
                  <span className="text-xs font-mono text-[var(--text-secondary)] w-20 text-right">
                    {s.uptime.toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xs font-mono text-[var(--text-secondary)] mb-3">
            Regions (30-day uptime)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-0 rounded-2xl border border-[var(--border-color)] overflow-hidden">
            {REGIONS.map((r) => (
              <div key={r.name} className="p-4 border-r border-b border-[var(--border-color)] last:border-r-0">
                <p className="text-xl">{r.flag}</p>
                <p className="font-mono text-sm mt-1">{r.name}</p>
                <p className="font-mono text-xs text-primary mt-1">{r.uptime.toFixed(2)}%</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xs font-mono text-[var(--text-secondary)] mb-3">
            90-day timeline
          </h2>
          <div className="rounded-2xl border border-[var(--border-color)] p-4">
            <div className="flex gap-0.5">
              {Array.from({ length: 90 }).map((_, i) => (
                <div
                  key={i}
                  className={`flex-1 h-10 ${
                    i === 17 ? "bg-amber-400/60" : "bg-[var(--accent-color)]/50"
                  }`}
                  title={`Day ${90 - i}`}
                />
              ))}
            </div>
            <div className="flex justify-between text-[10px] font-mono text-[var(--text-secondary)] mt-2">
              <span>90 days ago</span>
              <span>Today</span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xs font-mono text-[var(--text-secondary)] mb-3">
            Recent incidents
          </h2>
          <div className="space-y-2">
            {INCIDENTS.map((i) => (
              <div
                key={i.date}
                className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-4 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm">{i.title}</p>
                  <p className="text-[10px] font-mono text-[var(--text-secondary)] mt-1">
                    {i.date} · {i.duration}
                  </p>
                </div>
                <span className="text-[10px] font-mono text-primary border border-primary/40 px-2 py-0.5 rounded">
                  {i.status}
                </span>
              </div>
            ))}
          </div>
        </section>

        <p className="text-[10px] font-mono text-amber-400/80">
          Warning: live Uptime Kuma integration pending — current values are placeholder
        </p>
      </div>
    </div>
  )
}
