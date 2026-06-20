"use client";

import { motion } from "framer-motion";
import { easing } from "@/lib/motion";

/*
 * Capabilities section. The division-of-labor "timeline" ledger (two columns
 * with a center seam) was removed; this keeps just the section's framing copy.
 */

export function CapabilityTimeline() {
  return (
    <section id="features" className="pt-32 pb-12 overflow-hidden">
      <div className="max-w-[1100px] mx-auto px-8">
        <motion.div
          initial={{ opacity: 0, y: 48, filter: "blur(4px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.8, ease: easing.outExpo }}
          className="text-center"
        >
          <p className="text-xs text-accent-blue-rest uppercase tracking-[0.2em] mb-4 font-medium">Capabilities</p>
          <h2 className="text-[clamp(2rem,4vw,48px)] font-bold text-text-loud tracking-[-1.5px] mb-5">
            You own every layer. We keep it running.
          </h2>
          <p className="text-text-secondary text-lg max-w-[480px] mx-auto">
            A clean line between what&apos;s yours to control and what we operate for you, so nothing falls through.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
