"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { easing } from "@/lib/motion";
import { CountUp } from "@/components/marketing/motion/count-up";

const useCases = [
  {
    tag: "E-Commerce",
    title: "80% of tickets never reach a human.",
    desc: "A support agent that resolves, routes, and escalates — trained on your knowledge base, running 24/7.",
    stat: 90,
    statSuffix: "% deflection",
  },
  {
    tag: "SaaS",
    title: "Incidents down. Sleep up.",
    desc: "A DevOps agent that monitors logs, detects anomalies, and auto-resolves common failures before your team wakes up.",
    stat: 60,
    statSuffix: "% fewer pages",
  },
  {
    tag: "Agency",
    title: "10 clients. One operator.",
    desc: "White-label AI agents for every client — isolated data, custom config, your branding. Scale service without scaling headcount.",
    stat: 10,
    statSuffix: "x capacity",
  },
];

export function CaseStudyCarousel() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  return (
    <section ref={sectionRef} className="relative py-32 overflow-hidden">
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at 20% 50%, var(--glass-glow), transparent 60%), radial-gradient(ellipse at 80% 50%, rgba(1, 94, 254, 0.04), transparent 60%)",
          backgroundSize: "200% 200%",
          animation: "mesh-drift 20s ease infinite",
        }}
      />

      <div className="max-w-[1200px] mx-auto px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 48, filter: "blur(4px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.8, ease: easing.outExpo }}
          className="text-center mb-16"
        >
          <p className="text-xs text-accent-blue-rest uppercase tracking-[0.2em] mb-4 font-medium">Proof</p>
          <h2 className="text-[clamp(2rem,4vw,48px)] font-bold text-text-loud tracking-[-1.5px] mb-5">
            Already running in production.
          </h2>
          <p className="text-text-secondary text-lg max-w-[460px] mx-auto">
            Real results from teams that stopped doing it manually.
          </p>
        </motion.div>

        <div className="space-y-6 lg:space-y-8">
          {useCases.map((uc, i) => (
            <ProofPanel
              key={uc.tag}
              useCase={uc}
              index={i}
              scrollProgress={scrollYProgress}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ProofPanel({
  useCase,
  index,
  scrollProgress,
}: {
  useCase: typeof useCases[0];
  index: number;
  scrollProgress: ReturnType<typeof useScroll>["scrollYProgress"];
}) {
  const y = useTransform(scrollProgress, [0, 1], [index * 30, -index * 20]);

  return (
    <motion.div
      style={{ y }}
      initial={{ opacity: 0, y: 50, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.8, delay: index * 0.12, ease: easing.outExpo }}
      className="glass-glow rounded-3xl p-8 md:p-10 relative overflow-hidden group hover:shadow-[0_0_60px_var(--glass-glow)] transition-shadow duration-500"
    >
      <div className="flex flex-col md:flex-row md:items-center gap-8">
        <div className="flex-1">
          <span className="inline-block px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-accent-blue-rest bg-accent-blue-rest/10 rounded-full mb-4">
            {useCase.tag}
          </span>
          <h3 className="text-xl md:text-2xl font-bold text-text-loud mb-3 leading-tight">
            {useCase.title}
          </h3>
          <p className="text-sm text-text-secondary leading-relaxed max-w-md">
            {useCase.desc}
          </p>
        </div>

        <div className="shrink-0 text-center md:text-right">
          <div className="text-4xl md:text-5xl font-bold text-accent-blue-rest">
            <CountUp target={useCase.stat} suffix={useCase.statSuffix} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
