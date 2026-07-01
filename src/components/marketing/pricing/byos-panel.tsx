"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { easing } from "@/lib/motion"
import { BYOS_PLAN, formatUsd } from "@/configs/plans"
import { ArrowRight, Check, KeyRound, Server, Wallet } from "lucide-react"
import type { BillingInterval } from "./billing-interval-toggle"

export function ByosPanel({ interval }: { interval: BillingInterval }) {
  const price = interval === "year" ? BYOS_PLAN.displayPriceYearly : BYOS_PLAN.displayPriceMonthly

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 30, filter: "blur(4px)" }}
        whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ duration: 0.7, ease: easing.outExpo }}
        className="glass-subtle rounded-2xl p-8 relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,var(--glass-glow),transparent_70%)] pointer-events-none" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-text-loud">
              <Server className="w-5 h-5 text-accent-blue-rest" />
              <h3 className="text-xl font-bold">{BYOS_PLAN.name}</h3>
            </div>
            <p className="mt-2 text-text-secondary">
              Already have a server? We act as your management panel: deploy,
              monitor, restart, and configure your agent on infrastructure you
              own. Flat fee per server, no compute charges.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:gap-6 text-sm text-text-loud">
              <span className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-accent-blue-rest" /> 100 AI credits
                included, then top up as you go
              </span>
              <span className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-accent-blue-rest" /> Or bring your own
                API key
              </span>
            </div>
          </div>
          <div className="flex flex-col items-start lg:items-end gap-3">
            <div className="text-text-loud">
              <span className="text-3xl font-bold">{formatUsd(price)}</span>
              <span className="text-text-secondary text-sm">
                {interval === "year" ? "/yr" : "/mo"} per server
              </span>
            </div>
            <Link
              href="/dashboard/byos/connect"
              className="btn-green text-sm font-bold uppercase px-7 py-3.5 rounded-xl whitespace-nowrap"
            >
              Connect your server <ArrowRight className="w-4 h-4 shrink-0" />
            </Link>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
        whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ duration: 0.7, delay: 0.1, ease: easing.outExpo }}
        className="glass-subtle rounded-2xl p-8"
      >
        <h3 className="text-lg font-bold text-text-loud mb-4">What&apos;s included</h3>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">
          {BYOS_PLAN.features.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm">
              <Check className="w-4 h-4 text-accent-blue-rest shrink-0 mt-0.5" aria-hidden />
              <span className="text-text-loud leading-snug">{f}</span>
            </li>
          ))}
        </ul>
      </motion.div>
    </div>
  )
}
