"use client"

import { motion } from "framer-motion"
import { Check, X, ArrowRight } from "lucide-react"
import { BRANDING } from "@/configs/branding"
import { easing } from "@/lib/motion"

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, duration: 0.7, ease: easing.outExpo },
  }),
}

const comparisonRows = [
  { feature: "One-click AI agent deploy", us: true, vps: false, diy: false },
  { feature: "Agent optimization & tuning", us: true, vps: false, diy: false },
  { feature: "Managed configuration", us: true, vps: false, diy: false },
  { feature: "Multi-agent orchestration", us: true, vps: false, diy: false },
  { feature: "Monitoring & health alerts", us: true, vps: "partial", diy: false },
  { feature: "Full root access", us: true, vps: true, diy: true },
  { feature: "Outcome-focused setup", us: true, vps: false, diy: false },
  { feature: "Dedicated success engineer", us: true, vps: false, diy: false },
  { feature: "Audit logs & monitoring", us: true, vps: false, diy: false },
]

const positioningBlocks = [
  {
    title: "We are not hosting",
    desc: "VPS providers give you a blank server. You still need to install, configure, optimize, and maintain everything yourself. We give you a running AI agent.",
  },
  {
    title: "We are not just infra",
    desc: "Infrastructure is a commodity. What matters is what runs on it. We deliver outcomes: agents that automate real work, not empty compute.",
  },
  {
    title: "We are an AI operations layer",
    desc: `${BRANDING.name} sits above infrastructure. We handle deployment, configuration, monitoring, and optimization so you can focus on what your AI agents produce.`,
  },
]

function CellIcon({ value }: { value: boolean | string }) {
  if (value === true)
    return <Check className="w-5 h-5 text-primary inline-block" />
  if (value === "partial")
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)]">
        Partial
      </span>
    )
  return <X className="w-5 h-5 text-[var(--border-color)] inline-block" />
}

export default function ComparisonPage() {
  return (
    <div>
      {/* Hero */}
      <section className="max-w-[1400px] mx-auto px-8 pb-16">
        <motion.h1
          className="text-[3.5rem] md:text-[4rem] font-bold leading-[1.1] text-[var(--text-primary)] max-w-4xl"
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={0}
        >
          Why {BRANDING.name} vs{" "}
          <span className="text-primary">Traditional AI Deployment</span>
        </motion.h1>
        <motion.p
          className="text-[var(--text-secondary)] text-lg mt-4 max-w-2xl"
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={1}
        >
          Stop managing infrastructure. Start running AI systems.
        </motion.p>
      </section>

      {/* Comparison Table */}
      <section className="max-w-[1000px] mx-auto px-8 pb-20">
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-color)] bg-[var(--card-hover)]">
                <th className="text-left text-[var(--text-secondary)] font-bold py-4 px-5 text-xs">
                  Feature
                </th>
                <th className="text-center text-primary font-bold py-4 px-5 text-xs bg-primary/[0.06]">
                  {BRANDING.name}
                </th>
                <th className="text-center text-[var(--text-secondary)] font-bold py-4 px-5 text-xs">
                  VPS Providers
                </th>
                <th className="text-center text-[var(--text-secondary)] font-bold py-4 px-5 text-xs">
                  DIY Setup
                </th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr
                  key={row.feature}
                  className="border-b border-[var(--border-color)]/50 hover:bg-[var(--card-hover)] transition-colors"
                >
                  <td className="py-4 px-5 text-[var(--text-primary)] font-semibold">
                    {row.feature}
                  </td>
                  <td className="py-4 px-5 text-center bg-primary/[0.04]">
                    <CellIcon value={row.us} />
                  </td>
                  <td className="py-4 px-5 text-center">
                    <CellIcon value={row.vps} />
                  </td>
                  <td className="py-4 px-5 text-center">
                    <CellIcon value={row.diy} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Positioning Blocks */}
      <section className="max-w-[1400px] mx-auto px-8 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {positioningBlocks.map((block, i) => (
            <motion.div
              key={block.title}
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              custom={i}
              className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg-translucent)] shadow-[var(--shadow-sm)] p-8 transition-all duration-300 hover:border-primary hover:-translate-y-1"
            >
              <h3 className="text-xl font-bold text-primary mb-4">
                {block.title}
              </h3>
              <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
                {block.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-[1000px] mx-auto px-8 pb-24">
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-10 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(204,255,0,0.05)_0%,transparent_70%)] pointer-events-none" />
          <div className="relative z-10">
            <h3 className="text-2xl font-bold text-[var(--text-primary)] mb-3">
              Ready to See the Difference?
            </h3>
            <p className="text-[var(--text-secondary)] max-w-lg mx-auto mb-6">
              Book a demo and see how {BRANDING.name} deploys production AI agents
              in minutes, not weeks.
            </p>
            <a
              href={BRANDING.demoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-[var(--accent-color)] text-black font-bold text-sm px-8 py-4 hover:bg-white transition-colors rounded-lg"
            >
              Book a Demo <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
