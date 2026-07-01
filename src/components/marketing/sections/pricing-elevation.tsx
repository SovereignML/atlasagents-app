"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { easing } from "@/lib/motion";
import { ArrowRight } from "lucide-react";
import { ModeToggle, type PricingMode } from "@/components/marketing/pricing/mode-toggle";
import { ManagedPlansGrid } from "@/components/marketing/pricing/managed-plans-grid";
import { ByosPanel } from "@/components/marketing/pricing/byos-panel";

export function PricingElevation() {
  const [mode, setMode] = useState<PricingMode>("managed");

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
          <p className="text-xs text-accent-blue-rest uppercase tracking-[0.2em] mb-4 font-medium">Pricing</p>
          <h2 className="text-[clamp(2rem,4vw,48px)] font-bold text-text-loud tracking-[-1.5px] mb-5">
            Free to start. Built to scale.
          </h2>
          <p className="text-text-secondary text-lg max-w-[440px] mx-auto">
            Upgrade when your agents are pulling their weight, not before.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.5, delay: 0.2, ease: easing.outExpo }}
          className="flex justify-center mb-12"
        >
          <ModeToggle value={mode} onChange={setMode} />
        </motion.div>

        {mode === "managed" ? (
          <ManagedPlansGrid interval="month" />
        ) : (
          <ByosPanel interval="month" />
        )}

        <p className="mt-8 text-center">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 text-sm font-medium text-accent-blue-rest hover:underline"
          >
            See full pricing &amp; add-ons <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </p>
      </div>
    </section>
  );
}
