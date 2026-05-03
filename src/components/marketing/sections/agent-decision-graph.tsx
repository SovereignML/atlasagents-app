"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { easing } from "@/lib/motion";
import {
  Zap, Terminal, MessageSquare, Search, PenTool, TrendingUp, Share2, Settings,
} from "lucide-react";

const iconMap: Record<string, React.ElementType> = {
  Zap, Terminal, MessageSquare, Search, PenTool, TrendingUp, Share2, Settings,
};

const agents = [
  { icon: "MessageSquare", name: "Support", voice: "I resolve tickets before they escalate.", slug: "support" },
  { icon: "Terminal", name: "DevOps", voice: "I monitor, detect, and fix — autonomously.", slug: "devops" },
  { icon: "Zap", name: "Automation", voice: "I run your workflows while you sleep.", slug: "automation" },
  { icon: "Search", name: "Research", voice: "I surface insights from noise.", slug: "research" },
  { icon: "PenTool", name: "Content", voice: "I write, schedule, and optimize.", slug: "content" },
  { icon: "TrendingUp", name: "Sales", voice: "I qualify leads and close gaps.", slug: "sales" },
  { icon: "Share2", name: "Social", voice: "I grow your audience around the clock.", slug: "social" },
  { icon: "Settings", name: "Custom", voice: "I become whatever you need.", slug: "custom" },
];

export function AgentDecisionGraph() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start 0.9", "end 0.2"],
  });

  const centerGlowScale = useTransform(scrollYProgress, [0, 0.3], [0.5, 1]);
  const centerGlowOpacity = useTransform(scrollYProgress, [0, 0.3], [0, 0.06]);

  return (
    <section ref={sectionRef} id="agents" className="relative py-32 overflow-hidden">
      {/* Central radial glow */}
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[var(--color-primary)] blur-[120px] pointer-events-none"
        style={{ scale: centerGlowScale, opacity: centerGlowOpacity }}
      />

      <div className="max-w-[1200px] mx-auto px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.8, ease: easing.outExpo }}
          className="text-center mb-20"
        >
          <p className="text-xs text-[var(--color-primary)] uppercase tracking-[0.2em] mb-4 font-medium">System Awakening</p>
          <h2 className="text-[clamp(2rem,4vw,52px)] font-bold text-[var(--text-primary)] tracking-[-1.5px] mb-5">
            Eight agents. One system.
          </h2>
          <p className="text-[var(--text-secondary)] text-lg max-w-[480px] mx-auto leading-relaxed">
            Each agent is purpose-built, always running, and speaks for itself.
          </p>
        </motion.div>

        {/* Agent cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {agents.map((agent, i) => {
            const Icon = iconMap[agent.icon] || Zap;
            return (
              <AgentCard
                key={agent.slug}
                icon={Icon}
                name={agent.name}
                voice={agent.voice}
                index={i}
                scrollProgress={scrollYProgress}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

function AgentCard({
  icon: Icon,
  name,
  voice,
  index,
  scrollProgress,
}: {
  icon: React.ElementType;
  name: string;
  voice: string;
  index: number;
  scrollProgress: ReturnType<typeof useScroll>["scrollYProgress"];
}) {
  const threshold = 0.1 + index * 0.05;
  const cardOpacity = useTransform(scrollProgress, [threshold, threshold + 0.15], [0, 1]);
  const cardY = useTransform(scrollProgress, [threshold, threshold + 0.15], [40, 0]);
  const cardScale = useTransform(scrollProgress, [threshold, threshold + 0.15], [0.92, 1]);

  return (
    <motion.div
      style={{ opacity: cardOpacity, y: cardY, scale: cardScale, animationDelay: `${index * 0.6}s` }}
      whileHover={{ y: -6, scale: 1.03 }}
      transition={{ duration: 0.3, ease: easing.outExpo }}
      className="glass-glow rounded-2xl p-6 cursor-default group animate-[float_8s_ease-in-out_infinite]"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center">
          <Icon className="w-4.5 h-4.5 text-[var(--color-primary)]" />
        </div>
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">{name}</span>
      </div>
      <p className="text-sm text-[var(--text-primary)] leading-relaxed font-medium italic opacity-80 group-hover:opacity-100 transition-opacity">
        &ldquo;{voice}&rdquo;
      </p>
    </motion.div>
  );
}
