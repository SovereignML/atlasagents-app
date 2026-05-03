"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { easing, spring } from "@/lib/motion";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "What is SovereignML?",
    a: "An AI operations platform. You deploy intelligent agents that handle real work — support, sales, devops, content, research. You own the infrastructure and the data.",
  },
  {
    q: "What types of agents can I deploy?",
    a: "Eight categories: Automation, DevOps, Support, Research, Content, Sales, Social, and Custom. Each configurable to your exact requirements.",
  },
  {
    q: "Do I need AI expertise?",
    a: "No. You choose the task, we configure the agent. For complex multi-agent systems, our team designs and deploys custom solutions.",
  },
  {
    q: "How does pricing work?",
    a: "Credit-based. Free tier to start, then Builder ($79/mo), Operator ($199/mo), Scale ($399/mo), and Enterprise ($1,000+/mo). Credits cover AI usage, workflows, automations, and vector search.",
  },
  {
    q: "Can you build a custom AI system for my business?",
    a: "Yes. Book a strategy call. We design, build, and deploy multi-agent systems tailored to your workflows — with dedicated engineering support and production SLAs.",
  },
];

function FAQItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: easing.outExpo }}
      className={`glass-subtle rounded-2xl overflow-hidden transition-all duration-300 ${open ? "shadow-[0_0_30px_var(--glass-glow)]" : ""}`}
      style={open ? { borderLeft: "2px solid var(--color-primary)" } : {}}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex justify-between items-center p-5 text-left cursor-pointer"
      >
        <span className="text-base font-semibold text-[var(--text-primary)] pr-4">{q}</span>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={spring.snappy}
          className="shrink-0"
        >
          <ChevronDown className="w-4 h-4 text-[var(--color-primary)]" />
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
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{a}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function KnowledgeBaseFAQ() {
  return (
    <section className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--bg-secondary)]/30 to-transparent" />

      <div className="max-w-[720px] mx-auto px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.8, ease: easing.outExpo }}
          className="text-center mb-12"
        >
          <p className="text-xs text-[var(--color-primary)] uppercase tracking-[0.2em] mb-4 font-medium">Knowledge Base</p>
          <h2 className="text-[clamp(2rem,4vw,44px)] font-bold text-[var(--text-primary)] tracking-[-1.5px]">
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
