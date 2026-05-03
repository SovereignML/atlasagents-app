"use client";

import { motion } from "framer-motion";
import { easing } from "@/lib/motion";
import { MagneticButton } from "@/components/marketing/motion/magnetic-button";
import { BRANDING } from "@/configs/branding";

export function SignalBeacon() {
  return (
    <section id="demo-booking" className="relative py-32 overflow-hidden">
      {/* Radar rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="absolute w-[200px] h-[200px] rounded-full border border-[var(--color-primary)]/20 animate-[radar-ping_5s_ease-out_infinite]"
            style={{ animationDelay: `${i * 1.6}s` }}
          />
        ))}
        <div className="absolute w-3 h-3 rounded-full bg-[var(--color-primary)] shadow-[0_0_24px_rgba(126,185,67,0.5)] animate-[glow-breathe_3s_ease-in-out_infinite]" />
      </div>

      <div className="relative z-10 max-w-[800px] mx-auto px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.9, ease: easing.outExpo }}
          className="glass-glow rounded-3xl p-10 md:p-14 text-center"
        >
          <p className="text-xs text-[var(--color-primary)] uppercase tracking-[0.2em] mb-4 font-medium">Enterprise</p>
          <h2 className="text-[clamp(1.8rem,3.5vw,40px)] font-bold text-[var(--text-primary)] tracking-[-1px] mb-5 leading-tight">
            We build your AI system.<br />You own it.
          </h2>
          <p className="text-[var(--text-secondary)] text-base max-w-md mx-auto mb-4 leading-relaxed">
            Custom multi-agent architectures, designed and deployed by our team. Dedicated infrastructure. Your data never leaves your perimeter.
          </p>

          <div className="flex flex-wrap justify-center gap-6 text-xs text-[var(--text-muted)] mb-10">
            <span className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-[var(--color-primary)]" />Custom design & build</span>
            <span className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-[var(--color-primary)]" />Dedicated engineer</span>
            <span className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-[var(--color-primary)]" />Production SLA</span>
          </div>

          <MagneticButton className="inline-block">
            <a
              href={BRANDING.demoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-gradient text-base px-10 py-4"
            >
              Book a Strategy Call
            </a>
          </MagneticButton>
        </motion.div>
      </div>
    </section>
  );
}
