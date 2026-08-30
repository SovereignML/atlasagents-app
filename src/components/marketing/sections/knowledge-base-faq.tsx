"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { easing, spring } from "@/lib/motion";
import { ChevronDown } from "lucide-react";
import { BRANDING } from "@/configs/branding"

const faqs = [
  {
    q: `What is ${BRANDING.name}?`,
    a: "An AI operations platform. You deploy intelligent agents that handle real work: support, sales, devops, content, research. Your agents run in your own isolated, managed instance, with your configuration and data under your control.",
  },
  {
    q: "What are OpenClaw and Hermes?",
    a: "The two open, general-purpose agent runtimes your agents run on. Both handle the full range of work. Pick whichever fits your model preferences, or run both. Because they're open, you're never locked in: take your agents and your setup with you anytime.",
  },
  {
    q: "What types of agents can I deploy?",
    a: "Agents run on two open runtimes, OpenClaw and Hermes, across eight categories: Automation, DevOps, Support, Research, Content, Sales, Social Media, and Custom. Each configurable to your exact requirements.",
  },
  {
    q: "Do I need AI expertise?",
    a: "No. You choose the task, we configure the agent. For complex multi-agent systems, our team designs and deploys custom solutions.",
  },
  {
    q: "How does pricing work?",
    a: "Credit-based. Free tier to start, then Lite ($9/mo), Builder ($19/mo), Operator ($69/mo), Scale ($179/mo), and Enterprise (from $499/mo). Credits cover AI usage, workflows, automations, and vector search.",
  },
  {
    q: "Can you build a custom AI system for my business?",
    a: "Yes. Book a strategy call. We design, build, and deploy multi-agent systems tailored to your workflows, with dedicated engineering support and production SLAs.",
  },
];

function FAQItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: easing.outExpo }}
      className={`relative glass-subtle rounded-2xl overflow-hidden transition-shadow duration-300 ${open ? "shadow-[0_0_30px_var(--glass-glow)]" : ""}`}
    >
      {/* Animated accent bar — scales in on open instead of snapping a border
          (no layout shift, unlike a real left-border). */}
      <motion.span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent-blue-rest origin-top"
        initial={false}
        animate={{ scaleY: open ? 1 : 0, opacity: open ? 1 : 0 }}
        transition={spring.snappy}
      />
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex justify-between items-center p-5 text-left cursor-pointer"
      >
        <span className="text-base font-semibold text-text-loud pr-4">{q}</span>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={spring.snappy}
          className="shrink-0"
        >
          <ChevronDown className="w-4 h-4 text-accent-blue-rest" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: easing.outExpo }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5">
              <p className="text-sm text-text-secondary leading-relaxed">{a}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function KnowledgeBaseFAQ() {
  return (
    <section className="relative pt-32 pb-8 overflow-hidden lg:pb-12">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background-faint/30 to-transparent" />

      <div className="max-w-[720px] mx-auto px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 48, filter: "blur(4px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.8, ease: easing.outExpo }}
          className="text-center mb-12"
        >
          <p className="text-xs text-accent-blue-rest uppercase tracking-[0.2em] mb-4 font-medium">Knowledge Base</p>
          <h2 className="text-[clamp(2rem,4vw,44px)] font-bold text-text-loud tracking-[-1.5px]">
            Common questions.
          </h2>
        </motion.div>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <FAQItem key={faq.q} q={faq.q} a={faq.a} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
