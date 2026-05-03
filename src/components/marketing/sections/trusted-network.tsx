"use client";

import { motion } from "framer-motion";
import { easing } from "@/lib/motion";

const companies = [
  "ACME Corp", "LexTech", "MediCore", "FinServe", "DataFlow",
  "CyberDyne", "GlobalNet", "Stark Ind", "Umbrella", "Massive Dynamic",
];

export function TrustedNetwork() {
  return (
    <section className="relative py-12 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg-color)] to-[var(--bg-secondary)] opacity-60" />

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.5, ease: easing.outExpo }}
        className="relative z-10 text-[11px] text-[var(--text-muted)] text-center mb-6 uppercase tracking-[0.2em]"
      >
        Trusted by teams building with AI
      </motion.p>

      <div className="relative max-w-[1200px] mx-auto">
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="neural-line" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0" />
              <stop offset="30%" stopColor="var(--color-primary)" stopOpacity="0.15" />
              <stop offset="50%" stopColor="var(--color-primary)" stopOpacity="0.25" />
              <stop offset="70%" stopColor="var(--color-primary)" stopOpacity="0.15" />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <motion.line
            x1="0%" y1="50%" x2="100%" y2="50%"
            stroke="url(#neural-line)"
            strokeWidth="1"
            strokeDasharray="4 8"
            style={{ animation: "neural-pulse 2s linear infinite" }}
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 1.5, ease: easing.outExpo }}
          />
        </svg>

        <div
          className="relative w-full"
          style={{
            maskImage: "linear-gradient(to right, transparent, black 10%, black 90%, transparent)",
            WebkitMaskImage: "linear-gradient(to right, transparent, black 10%, black 90%, transparent)",
          }}
        >
          <div className="flex gap-14 w-max animate-[scroll_40s_linear_infinite] hover:[animation-play-state:paused]">
            {[...companies, ...companies].map((name, i) => (
              <motion.div
                key={`${name}-${i}`}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.5, delay: (i % 10) * 0.04, ease: easing.outExpo }}
                className="relative flex items-center gap-3 shrink-0 group"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] opacity-30 animate-[glow-breathe_4s_ease-in-out_infinite]" style={{ animationDelay: `${(i % 10) * 0.4}s` }} />
                <span className="font-medium text-sm text-[var(--text-secondary)] whitespace-nowrap opacity-50 group-hover:opacity-90 group-hover:text-[var(--text-primary)] transition-all duration-300 cursor-default">
                  {name}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
