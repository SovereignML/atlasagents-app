import Link from "next/link"
import { Reveal } from "@/components/marketing/motion/reveal"

const LAST_UPDATED = "June 2026"
const LEGAL_ENTITY = "SovereignML L.L.C., North Carolina"

export const metadata = {
  title: "Service Level Agreement | SovereignML",
  description: "SovereignML's uptime commitments, response times, and support standards.",
}

export default function SLAPage() {
  return (
    <div className="max-w-[900px] mx-auto px-8 py-16">
      <Reveal className="border-l-4 border-primary pl-8 mb-12">
        <div className="text-primary text-xs mb-3 opacity-80">
          Legal
        </div>
        <h1 className="text-[clamp(2rem,4vw,3.5rem)] font-bold text-[var(--text-primary)] mb-4">
          Service Level Agreement
        </h1>
        <p className="text-[var(--text-secondary)] text-sm">
          Last updated: {LAST_UPDATED} · {LEGAL_ENTITY}
        </p>
      </Reveal>

      {/* Uptime targets */}
      <Reveal as="section" id="uptime" className="mb-12">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4 pb-3 border-b border-[var(--border-color)]">
          <span className="text-primary mr-2 font-mono">01.</span>
          Uptime Commitment
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {/* {{TODO: confirm per-tier uptime targets with founder}} */}
          {[
            { plan: "Builder & Operator", uptime: "99.5%", monthly: "~3.6 hrs" },
            { plan: "Scale", uptime: "99.9%", monthly: "~43 min" },
            { plan: "Enterprise", uptime: "99.99%", monthly: "~4.3 min" },
          ].map((tier) => (
            <div key={tier.plan} className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-5 text-center">
              <p className="text-primary text-xs mb-2 font-mono">
                {tier.plan}
              </p>
              <p className="text-3xl font-bold text-[var(--text-primary)] mb-1">
                {tier.uptime}
              </p>
              <p className="text-[var(--text-secondary)] text-xs">Max {tier.monthly} downtime/mo</p>
            </div>
          ))}
        </div>
        <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
          Uptime is measured monthly as the percentage of minutes the SovereignML platform API and dashboard are available and responding to requests. Scheduled maintenance windows (announced 48 hours in advance) are excluded from uptime calculations.
        </p>
      </Reveal>

      {/* Support */}
      <Reveal as="section" id="support" className="mb-12">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4 pb-3 border-b border-[var(--border-color)]">
          <span className="text-primary mr-2 font-mono">02.</span>
          Support Response Times
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[var(--border-color)] bg-[var(--card-hover)]">
                {["Plan", "Channel", "Response Time", "Hours"].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-primary text-xs font-mono"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { plan: "Starter", channel: "Community Forum", response: "Best effort", hours: "N/A" },
                { plan: "Pro", channel: "Priority Email", response: "< 24 hours", hours: "Mon–Fri" },
                { plan: "Enterprise", channel: "Phone + Slack", response: "< 2 hours", hours: "24/7" },
              ].map((row, i) => (
                <tr
                  key={row.plan}
                  className={`border-b border-[var(--border-color)] ${i % 2 === 0 ? "bg-[var(--card-bg)]" : ""}`}
                >
                  <td className="px-4 py-3 text-[var(--text-primary)] font-medium">{row.plan}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{row.channel}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{row.response}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{row.hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      {/* Health checks */}
      <Reveal as="section" id="monitoring" className="mb-12">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4 pb-3 border-b border-[var(--border-color)]">
          <span className="text-primary mr-2 font-mono">03.</span>
          Health Checks & Monitoring
        </h2>
        <div className="space-y-4">
          {[
            { plan: "Builder & Operator", interval: "Daily", alerts: "None", desc: "Daily health status checks on deployed agents." },
            { plan: "Scale", interval: "Hourly", alerts: "Email alerts", desc: "Hourly health checks with email notification on degradation." },
            { plan: "Enterprise", interval: "Real-time", alerts: "Chat + Phone", desc: "Continuous real-time monitoring with immediate multi-channel alerting." },
          ].map((tier) => (
            <div key={tier.plan} className="rounded-2xl border border-[var(--border-color)] shadow-[var(--shadow-sm)] p-5 flex gap-4">
              <div className="shrink-0">
                <span className="text-primary text-xs border border-primary/30 px-2 py-1 rounded font-mono">
                  {tier.plan}
                </span>
              </div>
              <div>
                <p className="text-[var(--text-primary)] font-medium text-sm mb-1">
                  {tier.interval} checks: {tier.alerts}
                </p>
                <p className="text-[var(--text-secondary)] text-sm">{tier.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Reveal>

      {/* Credits */}
      <Reveal as="section" id="credits" className="mb-12">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4 pb-3 border-b border-[var(--border-color)]">
          <span className="text-primary mr-2 font-mono">04.</span>
          Service Credits
        </h2>
        <p className="text-[var(--text-secondary)] text-sm leading-relaxed mb-4">
          If SovereignML fails to meet the uptime commitment in a given calendar month, eligible users may request a service credit:
        </p>
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[var(--border-color)] bg-[var(--card-hover)]">
                {["Monthly Uptime", "Credit"].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-primary text-xs font-mono"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { uptime: "99.0% – 99.49%", credit: "10% of monthly fee" },
                { uptime: "95.0% – 98.99%", credit: "25% of monthly fee" },
                { uptime: "< 95.0%", credit: "50% of monthly fee" },
              ].map((row, i) => (
                <tr key={row.uptime} className={`border-b border-[var(--border-color)] ${i % 2 === 0 ? "bg-[var(--card-bg)]" : ""}`}>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{row.uptime}</td>
                  <td className="px-4 py-3 text-[var(--text-primary)] font-medium">{row.credit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
          Credits are applied to future invoices and are not redeemable for cash. To request a credit, contact billing@sovereignml.com within 30 days of the incident with the date range and description of the outage.
        </p>
      </Reveal>

      {/* Exclusions */}
      <Reveal as="section" id="exclusions" className="mb-12">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4 pb-3 border-b border-[var(--border-color)]">
          <span className="text-primary mr-2 font-mono">05.</span>
          Exclusions
        </h2>
        <p className="text-[var(--text-secondary)] text-sm leading-relaxed mb-3">
          The SLA does not apply to downtime caused by:
        </p>
        <ul className="space-y-2">
          {[
            "Scheduled maintenance windows (announced 48+ hours in advance)",
            "Force majeure events: natural disasters, war, government action, internet backbone outages",
            "Actions or inactions by the customer that cause service degradation",
            "Third-party service outages (Stripe, Google OAuth, Resend) outside SovereignML’s control",
            "Beta or experimental features explicitly marked as such",
            "Free tier accounts (the SLA applies only to paid subscriptions)",
          ].map((item) => (
            <li key={item} className="flex items-start gap-3 text-sm text-[var(--text-secondary)]">
              <span className="text-primary mt-0.5">&rsaquo;</span>
              {item}
            </li>
          ))}
        </ul>
      </Reveal>

      {/* Footer */}
      <div className="mt-16 pt-8 border-t border-[var(--border-color)] flex flex-col sm:flex-row gap-4 justify-between items-start">
        <p className="text-[var(--text-secondary)] text-sm">
          &copy; {new Date().getFullYear()} {LEGAL_ENTITY}. All rights reserved.
        </p>
        <div className="flex gap-6 text-sm">
          <Link
            href="/privacy"
            className="text-[var(--text-secondary)] hover:text-primary transition-colors"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms"
            className="text-[var(--text-secondary)] hover:text-primary transition-colors"
          >
            Terms of Service
          </Link>
        </div>
      </div>
    </div>
  )
}
