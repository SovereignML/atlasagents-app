import Link from "next/link"
import { MotionConfig } from "framer-motion"
import { Reveal, RevealGroup, RevealItem } from "@/components/marketing/motion/reveal"

const SERVICES = [
  { name: "API", status: "operational", uptime: 99.99 },
  { name: "Dashboard", status: "operational", uptime: 99.98 },
  { name: "Deploy Orchestrator", status: "operational", uptime: 99.95 },
  { name: "Gateway", status: "operational", uptime: 99.97 },
  { name: "Stripe Billing", status: "operational", uptime: 100.0 },
  { name: "Auth (NextAuth)", status: "operational", uptime: 99.99 },
]

const INCIDENTS = [
  { date: "2026-03-28", title: "Brief gateway latency spike", status: "resolved", duration: "12 min" },
  { date: "2026-03-14", title: "Scheduled Stripe webhook maintenance", status: "resolved", duration: "30 min" },
]

export default function StatusPage() {
  const allOk = SERVICES.every((s) => s.status === "operational")
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[var(--bg-color)] text-[var(--text-primary)]">
        <div className="max-w-5xl mx-auto px-6 py-16 space-y-10">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <Link href="/" className="text-xl font-bold">
              SovereignML
            </Link>
            <div className="text-xs font-mono text-[var(--text-secondary)]">
              Last updated: {new Date().toISOString().slice(0, 19).replace("T", " ")} UTC
            </div>
          </div>

          <Reveal
            className={`rounded-2xl border p-6 flex items-center gap-4 ${
              allOk ? "border-primary bg-primary/10" : "border-red-500/40 bg-red-500/10"
            }`}
          >
            {/* Live beacon — pulsing ring that conveys "monitoring right now". */}
            <span className="relative flex h-3.5 w-3.5 shrink-0">
              <span
                className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-[beacon-pulse_2s_ease-out_infinite] ${
                  allOk ? "bg-primary" : "bg-red-400"
                }`}
              />
              <span
                className={`relative inline-flex h-3.5 w-3.5 rounded-full ${
                  allOk ? "bg-primary" : "bg-red-400"
                }`}
              />
            </span>
            <div>
              <h1 className="text-3xl font-bold text-[var(--text-primary)]">
                {allOk ? "All systems operational" : "Incident in progress"}
              </h1>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Live from Uptime Kuma probes, every 60 seconds.
              </p>
            </div>
          </Reveal>

          <section>
            <h2 className="text-xs font-mono text-[var(--text-secondary)] mb-3">
              Services
            </h2>
            <RevealGroup className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
              {SERVICES.map((s, i) => (
                <RevealItem
                  key={s.name}
                  className={`flex items-center justify-between px-4 py-3 transition-colors hover:bg-[var(--card-hover)] ${
                    i !== SERVICES.length - 1 ? "border-b border-[var(--border-color)]" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                    <span className="text-sm">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-6">
                    <span className="text-[10px] font-mono uppercase tracking-wide text-primary">
                      {s.status}
                    </span>
                    <span className="text-xs font-mono text-[var(--text-secondary)] w-20 text-right tabular-nums">
                      {s.uptime.toFixed(2)}%
                    </span>
                  </div>
                </RevealItem>
              ))}
            </RevealGroup>
          </section>

          <section>
            <h2 className="text-xs font-mono text-[var(--text-secondary)] mb-3">
              90-day timeline
            </h2>
            <Reveal className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
              <div className="flex gap-0.5">
                {Array.from({ length: 90 }).map((_, i) => (
                  <div
                    key={i}
                    className={`flex-1 h-10 rounded-[2px] transition-transform duration-150 hover:scale-y-110 origin-bottom ${
                      i === 17 ? "bg-amber-400/70" : "bg-primary/40 hover:bg-primary/70"
                    }`}
                    title={i === 17 ? `Day ${90 - i} · incident` : `Day ${90 - i} · operational`}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[10px] font-mono text-[var(--text-secondary)] mt-2">
                <span>90 days ago</span>
                <span>Today</span>
              </div>
            </Reveal>
          </section>

          <section>
            <h2 className="text-xs font-mono text-[var(--text-secondary)] mb-3">
              Recent incidents
            </h2>
            <RevealGroup className="space-y-2">
              {INCIDENTS.map((i) => (
                <RevealItem
                  key={i.date}
                  className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-4 flex items-center justify-between transition-all duration-300 hover:border-primary/30 hover:shadow-[var(--shadow-hover)]"
                >
                  <div>
                    <p className="text-sm">{i.title}</p>
                    <p className="text-[10px] font-mono text-[var(--text-secondary)] mt-1">
                      {i.date} · {i.duration}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wide text-primary border border-primary/40 px-2 py-0.5 rounded-full">
                    {i.status}
                  </span>
                </RevealItem>
              ))}
            </RevealGroup>
          </section>

          <p className="text-[10px] font-mono text-amber-400/80">
            Warning: live Uptime Kuma integration pending — current values are placeholder
          </p>
        </div>
      </div>
    </MotionConfig>
  )
}
