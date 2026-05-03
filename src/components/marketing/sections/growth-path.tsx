"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { easing, spring } from "@/lib/motion";

const milestones = [
  { label: "Try", tier: "Free", price: "$0/mo", desc: "Deploy your first agent" },
  { label: "Build", tier: "Builder", price: "$79/mo", desc: "Multiple agents & workflows" },
  { label: "Operate", tier: "Operator", price: "$199/mo", desc: "Production-grade operations" },
  { label: "Scale", tier: "Enterprise", price: "$1,000+/mo", desc: "Full AI workforce" },
];

export function GrowthPath() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start 0.6", "end 0.4"],
  });

  const pathProgress = useTransform(scrollYProgress, [0, 1], [0, 1]);
  const travelerX = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <section ref={sectionRef} className="py-32 overflow-hidden">
      <div className="max-w-[1100px] mx-auto px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.7, ease: easing.outExpo }}
          className="text-center mb-20"
        >
          <h2 className="text-[clamp(2rem,4vw,48px)] font-bold text-[var(--text-primary)] tracking-[-1.5px] mb-4">
            Your Growth Path
          </h2>
          <p className="text-[var(--text-secondary)] text-lg max-w-[500px] mx-auto">
            Start with one agent. Scale to an entire AI workforce.
          </p>
        </motion.div>

        {/* Desktop: Horizontal path with traveler */}
        <div className="hidden md:block relative">
          {/* Track */}
          <div className="relative h-[2px] bg-[var(--border-color)] rounded-full mx-8 mb-12">
            {/* Animated progress fill */}
            <motion.div
              className="absolute inset-y-0 left-0 bg-[var(--color-primary)] rounded-full"
              style={{ width: travelerX }}
            />
            {/* Glowing traveler dot */}
            <motion.div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[var(--color-primary)] shadow-[0_0_20px_rgba(126,185,67,0.7)] -ml-2"
              style={{ left: travelerX }}
            />
          </div>

          {/* Milestone nodes */}
          <div className="grid grid-cols-4 gap-4">
            {milestones.map((m, i) => {
              const threshold = i / (milestones.length - 1);
              return (
                <MilestoneCard
                  key={m.label}
                  milestone={m}
                  index={i}
                  scrollProgress={scrollYProgress}
                  threshold={threshold}
                />
              );
            })}
          </div>
        </div>

        {/* Mobile: Vertical timeline */}
        <div className="md:hidden space-y-6">
          {milestones.map((m, i) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: 0.5, delay: i * 0.1, ease: easing.outExpo }}
              className="flex items-start gap-4"
            >
              <div className="w-8 h-8 rounded-full bg-[var(--color-primary)]/20 flex items-center justify-center shrink-0 border-2 border-[var(--color-primary)]">
                <span className="text-xs font-bold text-[var(--color-primary)]">{i + 1}</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)]">{m.label} — {m.tier}</h3>
                <p className="text-sm text-[var(--text-secondary)]">{m.desc}</p>
                <p className="text-sm font-semibold text-[var(--color-primary)] mt-1">{m.price}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MilestoneCard({
  milestone,
  index,
  scrollProgress,
  threshold,
}: {
  milestone: typeof milestones[0];
  index: number;
  scrollProgress: ReturnType<typeof useScroll>["scrollYProgress"];
  threshold: number;
}) {
  const opacity = useTransform(scrollProgress, [Math.max(0, threshold - 0.1), threshold + 0.05], [0.4, 1]);
  const scale = useTransform(scrollProgress, [Math.max(0, threshold - 0.1), threshold + 0.05], [0.9, 1]);
  const y = useTransform(scrollProgress, [Math.max(0, threshold - 0.1), threshold + 0.05], [20, 0]);

  return (
    <motion.div
      style={{ opacity, scale, y }}
      className="text-center p-6 rounded-2xl bg-[var(--card-bg)] border border-[var(--border-color)] shadow-[var(--shadow-sm)]"
    >
      <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center mx-auto mb-3">
        <span className="text-lg font-bold text-[var(--color-primary)]">{index + 1}</span>
      </div>
      <h3 className="text-lg font-bold text-[var(--text-primary)] mb-1">{milestone.label}</h3>
      <p className="text-sm text-[var(--text-secondary)] mb-2">{milestone.desc}</p>
      <p className="text-base font-bold text-[var(--color-primary)]">{milestone.price}</p>
    </motion.div>
  );
}
