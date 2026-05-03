"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { easing } from "@/lib/motion";
import {
  Rocket, Shield, Activity, Layers, TrendingUp, Wrench, Globe, GitBranch, Cpu,
} from "lucide-react";

const features = [
  { title: "Deploy in seconds", desc: "Production-ready agents. One click. Zero config.", icon: Rocket },
  { title: "Your data. Period.", desc: "Isolated infrastructure. No shared tenancy. Full sovereignty.", icon: Shield },
  { title: "Watch them work", desc: "Live health, latency, and decision metrics — always visible.", icon: Activity },
  { title: "Every agent type", desc: "Support, sales, devops, content, research, automation, custom.", icon: Layers },
  { title: "Scales itself", desc: "Traffic spikes handled automatically. No manual intervention.", icon: TrendingUp },
  { title: "Continuously optimized", desc: "We tune for outcomes, not just uptime.", icon: Wrench },
  { title: "Global edge", desc: "Deploy agents in the region closest to your users.", icon: Globe },
  { title: "Version control", desc: "Roll back any agent to any version. One click.", icon: GitBranch },
  { title: "Multi-agent orchestration", desc: "Agents that talk to each other. Complex workflows, simple interface.", icon: Cpu },
];

export function CapabilityTimeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 0.8", "end 0.2"],
  });

  const lineHeight = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <section id="features" className="py-32 overflow-hidden">
      <div className="max-w-[1100px] mx-auto px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.8, ease: easing.outExpo }}
          className="text-center mb-20"
        >
          <p className="text-xs text-[var(--color-primary)] uppercase tracking-[0.2em] mb-4 font-medium">Capabilities</p>
          <h2 className="text-[clamp(2rem,4vw,48px)] font-bold text-[var(--text-primary)] tracking-[-1.5px] mb-5">
            Full control over every layer.
          </h2>
          <p className="text-[var(--text-secondary)] text-lg max-w-[480px] mx-auto">
            From first deploy to global scale — own the entire lifecycle.
          </p>
        </motion.div>

        {/* Desktop: Helix layout */}
        <div ref={containerRef} className="relative hidden md:block">
          {/* Central spine */}
          <div className="absolute left-1/2 top-0 -translate-x-1/2 w-px h-full bg-[var(--border-color)]">
            <motion.div
              className="w-full bg-gradient-to-b from-[var(--color-primary)] to-[var(--color-primary)]/30 origin-top"
              style={{ height: lineHeight }}
            />
          </div>

          <div className="space-y-12">
            {features.map((f, i) => {
              const isLeft = i % 2 === 0;
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, x: isLeft ? -50 : 50 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.5 }}
                  transition={{ duration: 0.7, ease: easing.outExpo }}
                  className={`flex items-center gap-6 ${isLeft ? "flex-row" : "flex-row-reverse"}`}
                >
                  <div className={`w-[calc(50%-28px)] ${isLeft ? "text-right" : "text-left"}`}>
                    <div className={`inline-block glass-glow rounded-2xl p-5 hover:scale-[1.02] transition-transform duration-300 ${isLeft ? "ml-auto" : ""}`}>
                      <div className={`flex items-center gap-3 mb-2 ${isLeft ? "justify-end" : ""}`}>
                        <Icon className={`w-5 h-5 text-[var(--color-primary)] ${isLeft ? "order-2" : ""}`} />
                        <h3 className="text-base font-bold text-[var(--text-primary)]">{f.title}</h3>
                      </div>
                      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{f.desc}</p>
                    </div>
                  </div>

                  {/* Node */}
                  <motion.div
                    initial={{ scale: 0 }}
                    whileInView={{ scale: 1 }}
                    viewport={{ once: true, amount: 0.5 }}
                    transition={{ duration: 0.4, delay: 0.2, ease: easing.outExpo }}
                    className="w-3 h-3 rounded-full bg-[var(--color-primary)] shadow-[0_0_16px_rgba(126,185,67,0.5)] shrink-0 z-10 border-2 border-[var(--bg-color)]"
                  />

                  <div className="w-[calc(50%-28px)]" />
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Mobile */}
        <div className="md:hidden grid grid-cols-1 gap-3">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.5, delay: i * 0.04, ease: easing.outExpo }}
                className="glass-subtle rounded-2xl p-5"
              >
                <div className="flex items-center gap-3 mb-2">
                  <Icon className="w-5 h-5 text-[var(--color-primary)]" />
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">{f.title}</h3>
                </div>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{f.desc}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
