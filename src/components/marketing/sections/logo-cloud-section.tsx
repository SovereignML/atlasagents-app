"use client";

import { motion } from "framer-motion";
import { easing } from "@/lib/motion";
import { LogoCloud } from "@/components/ui/logo-cloud-2";

/*
 * Ecosystem / tech strip rendered with the bordered LogoCloud grid.
 *
 * Framed as "works with" (models + tooling the platform integrates with) —
 * NOT as partnerships or backers. Memberships/backers stay behind the
 * integrity gate in backed-by.tsx. Six supported providers, laid out 3×2.
 */
export function LogoCloudSection() {
  return (
    <section className="relative z-10 py-24 overflow-x-clip">
      <motion.div
        initial={{ opacity: 0, y: 24, filter: "blur(4px)" }}
        whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ duration: 0.8, ease: easing.outExpo }}
        className="relative mx-auto grid max-w-3xl px-4 md:px-0"
      >
        <h2 className="mb-6 text-center font-medium text-lg text-muted-foreground tracking-tight md:text-2xl">
          Runs on the{" "}
          <span className="font-semibold text-primary">AI</span> and{" "}
          <span className="font-semibold text-primary">Cloud</span> you already trust
        </h2>

        <LogoCloud />
      </motion.div>
    </section>
  );
}
