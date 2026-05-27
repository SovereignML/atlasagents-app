"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { easing, spring } from "@/lib/motion";
import { PLANS, formatUsd } from "@/configs/plans";
import { BRANDING } from "@/configs/branding";
import { Check, X, ArrowRight } from "lucide-react";
import { BillingIntervalToggle, type BillingInterval } from "@/components/marketing/pricing/billing-interval-toggle";
import type { PlanConfig } from "@/configs/plans";

const corePlans = PLANS.filter((p) => ["builder", "operator", "scale"].includes(p.tier));
const freePlan = PLANS.find((p) => p.tier === "free")!;
const enterprisePlan = PLANS.find((p) => p.tier === "enterprise")!;

function PriceDisplay({ plan, interval }: { plan: PlanConfig; interval: BillingInterval }) {
  if (plan.tier === "free") {
    return (
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold text-text-loud">{formatUsd(0)}</span>
        <span className="text-text-secondary text-sm">/mo</span>
      </div>
    );
  }
  if (plan.tier === "enterprise" && plan.enterprisePriceLabel) {
    return (
      <span className="text-2xl font-bold text-text-loud">{plan.enterprisePriceLabel}</span>
    );
  }
  const isYear = interval === "year";
  const amount = isYear ? plan.displayPriceYearly : plan.displayPriceMonthly;
  return (
    <div>
      <div className="flex items-baseline gap-1">
        <span className="text-4xl font-bold text-text-loud">{formatUsd(amount)}</span>
        <span className="text-text-secondary">{isYear ? "/year" : "/mo"}</span>
      </div>
      {isYear && <p className="mt-1 text-xs font-mono text-accent-blue-rest">2 months free</p>}
    </div>
  );
}

export function PricingElevation() {
  const [interval, setInterval] = useState<BillingInterval>("month");

  return (
    <section id="pricing" className="relative py-32 overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-accent-blue-rest opacity-[0.03] blur-[120px] rounded-full pointer-events-none" />

      <div className="max-w-[1100px] mx-auto px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 48, filter: "blur(4px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.8, ease: easing.outExpo }}
          className="text-center mb-10"
        >
          <p className="text-xs text-accent-blue-rest uppercase tracking-[0.2em] mb-4 font-medium">Investment</p>
          <h2 className="text-[clamp(2rem,4vw,48px)] font-bold text-text-loud tracking-[-1.5px] mb-5">
            Choose your operating layer.
          </h2>
          <p className="text-text-secondary text-lg max-w-[440px] mx-auto">
            Start free. Scale when your agents prove their value.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.5, delay: 0.2, ease: easing.outExpo }}
          className="flex justify-center mb-12"
        >
          <BillingIntervalToggle value={interval} onChange={setInterval} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 50, filter: "blur(4px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.1 }}
          transition={{ duration: 0.9, ease: easing.outExpo }}
          style={{ perspective: "1200px" }}
        >
          <motion.div
            initial={{ rotateX: 3 }}
            whileInView={{ rotateX: 0 }}
            viewport={{ once: true, amount: 0.1 }}
            transition={spring.gentle}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              {corePlans.map((plan, i) => (
                <motion.div
                  key={plan.slug}
                  initial={{ opacity: 0, y: 30, filter: "blur(4px)" }}
                  whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  viewport={{ once: true, amount: 0.15 }}
                  transition={{ duration: 0.6, delay: i * 0.08, ease: easing.outExpo }}
                  className={`relative flex flex-col p-7 rounded-2xl border transition-all duration-200 ${
                    plan.highlight
                      ? "border-accent-blue-rest glass-glow shadow-[0_0_30px_var(--glass-glow)]"
                      : "border-border-ghost glass"
                  } hover:scale-[1.02]`}
                >
                  {plan.highlight && (
                    <div className="absolute -top-3 left-6 bg-accent-blue-rest text-black text-[10px] font-bold uppercase px-3 py-1 rounded-full">
                      Most Popular
                    </div>
                  )}

                  <h3 className="text-xl font-bold text-text-loud">{plan.name}</h3>
                  <p className="mt-1 text-xs text-text-secondary">{plan.description}</p>

                  <div className="mt-5 mb-6">
                    <PriceDisplay plan={plan} interval={interval} />
                  </div>

                  <ul className="space-y-2 flex-1 mb-6">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className="w-3.5 h-3.5 text-accent-blue-rest shrink-0 mt-0.5" />
                        <span className="text-text-loud leading-snug">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href="/login?deploy=true"
                    className={`block text-center py-3 text-sm font-bold uppercase rounded-xl transition-all ${
                      plan.highlight
                        ? "btn-green"
                        : "border border-border-ghost text-text-loud hover:border-accent-blue-rest hover:text-accent-blue-rest"
                    }`}
                  >
                    Get Started
                  </Link>
                </motion.div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <motion.div
                initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
                whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: 0.6, delay: 0.3, ease: easing.outExpo }}
                className="glass-subtle rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center gap-5"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-text-loud">{freePlan.name}</h3>
                    <PriceDisplay plan={freePlan} interval={interval} />
                  </div>
                  <p className="text-xs text-text-secondary mb-3">{freePlan.description}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {freePlan.features.map((f) => (
                      <span key={f} className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <Check className="w-3 h-3 text-accent-blue-rest shrink-0" />{f}
                      </span>
                    ))}
                    {freePlan.restrictions?.map((r) => (
                      <span key={r} className="flex items-center gap-1.5 text-xs text-text-muted">
                        <X className="w-3 h-3 shrink-0 opacity-50" />{r}
                      </span>
                    ))}
                  </div>
                </div>
                <Link
                  href="/login?deploy=true"
                  className="shrink-0 inline-flex items-center justify-center px-5 py-2.5 text-xs font-bold uppercase rounded-xl border border-border-ghost text-text-loud hover:border-accent-blue-rest hover:text-accent-blue-rest transition-all"
                >
                  Start Free
                </Link>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
                whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: 0.6, delay: 0.4, ease: easing.outExpo }}
                className="glass-subtle rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center gap-5 relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,var(--glass-glow),transparent_70%)] pointer-events-none" />
                <div className="relative flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-text-loud">{enterprisePlan.name}</h3>
                    <span className="text-sm font-bold text-text-secondary">From {enterprisePlan.enterprisePriceLabel}</span>
                  </div>
                  <p className="text-xs text-text-secondary mb-3">{enterprisePlan.description}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {enterprisePlan.features.slice(0, 4).map((f) => (
                      <span key={f} className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <Check className="w-3 h-3 text-accent-blue-rest shrink-0" />{f}
                      </span>
                    ))}
                  </div>
                </div>
                <a
                  href={BRANDING.demoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative shrink-0 inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold uppercase rounded-xl border border-border-ghost text-text-loud hover:border-accent-blue-rest hover:text-accent-blue-rest transition-all"
                >
                  Contact Sales <ArrowRight className="w-3 h-3" />
                </a>
              </motion.div>
            </div>

            <p className="mt-8 text-center">
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 text-sm font-medium text-accent-blue-rest hover:underline"
              >
                Usage, overages & add-ons <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
