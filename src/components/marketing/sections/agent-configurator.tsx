"use client";

import { motion } from "framer-motion";
import { easing } from "@/lib/motion";
import { SmartPlanner } from "@/components/marketing/smart-planner";

export function AgentConfigurator() {
  return (
    <section className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background-faint/40 to-transparent" />

      <div className="max-w-[1000px] mx-auto px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 48, filter: "blur(4px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.8, ease: easing.outExpo }}
          className="text-center mb-14"
        >
          <p className="text-xs text-accent-blue-rest uppercase tracking-[0.2em] mb-4 font-medium">Configure</p>
          <h2 className="text-[clamp(2rem,4vw,48px)] font-bold text-text-loud tracking-[-1.5px] mb-4">
            Tell us the task. We build the agent.
          </h2>
          <p className="text-text-secondary text-lg max-w-[460px] mx-auto">
            Select what you need automated. Get a ready-to-deploy configuration in seconds.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 48, filter: "blur(4px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.9, ease: easing.outExpo }}
        >
          <SmartPlanner />
        </motion.div>
      </div>
    </section>
  );
}
