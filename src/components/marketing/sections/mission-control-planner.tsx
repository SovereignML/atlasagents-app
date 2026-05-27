"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { easing } from "@/lib/motion";

const STATUS_AGENTS = [
  { name: "Support Agent", status: "active", uptime: "99.97%" },
  { name: "DevOps Agent", status: "active", uptime: "99.99%" },
  { name: "Sales Agent", status: "active", uptime: "99.94%" },
  { name: "Content Agent", status: "idle", uptime: "100%" },
];

const TASK_FEED = [
  "Triaging ticket #4821 → routing to L2",
  "Anomaly detected in us-east-1 latency",
  "Lead score updated: Acme Corp → 87/100",
  "Blog draft generated: Q3 Market Analysis",
  "Auto-scaling triggered: +2 replicas",
  "Ticket #4819 resolved in 42s",
  "CRM sync completed: 340 records",
  "SSL cert renewal verified for *.app.io",
  "Outbound sequence paused: low engagement",
  "Vector index rebuilt: 12.4M embeddings",
];

const DECISION_LOG = [
  { time: "now", msg: "Route ticket to billing team", agent: "Support" },
  { time: "2s ago", msg: "Scale infra: CPU > 80% threshold", agent: "DevOps" },
  { time: "8s ago", msg: "Disqualify lead: no budget signal", agent: "Sales" },
  { time: "14s ago", msg: "Schedule post for peak engagement", agent: "Content" },
  { time: "21s ago", msg: "Rollback deploy: health check failed", agent: "DevOps" },
  { time: "30s ago", msg: "Escalate: VIP customer detected", agent: "Support" },
];

export function MissionControlPlanner() {
  const reduceMotion = useReducedMotion();
  const [visibleTasks, setVisibleTasks] = useState(TASK_FEED.slice(0, 4));
  const taskIndex = useRef(4);

  const rotateTasks = useCallback(() => {
    setVisibleTasks((prev) => {
      const next = [...prev.slice(1), TASK_FEED[taskIndex.current % TASK_FEED.length]];
      taskIndex.current++;
      return next;
    });
  }, []);

  useEffect(() => {
    // Respect "Reduce Motion": keep the task feed static (no auto-rotation).
    if (reduceMotion) return;
    const interval = setInterval(rotateTasks, 2800);
    return () => clearInterval(interval);
  }, [rotateTasks, reduceMotion]);

  return (
    <section id="planner" className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background-faint to-transparent opacity-60" />
      <div
        className="absolute inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: "linear-gradient(var(--color-accent-blue-rest) 1px, transparent 1px), linear-gradient(90deg, var(--color-accent-blue-rest) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
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
          <p className="text-xs text-accent-blue-rest uppercase tracking-[0.2em] mb-4 font-medium">Live Operations</p>
          <h2 className="text-[clamp(2rem,4vw,48px)] font-bold text-text-loud tracking-[-1.5px] mb-4">
            Your agents are working right now.
          </h2>
          <p className="text-text-secondary text-lg max-w-[500px] mx-auto">
            Real-time view of agent activity, decisions, and system health.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 48, filter: "blur(4px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.9, ease: easing.outExpo }}
          className="glass rounded-3xl p-1"
        >
          <div className="rounded-[22px] bg-background-plain/80 backdrop-blur-sm border border-border-ghost overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border-muted">
              <div className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
              <span className="ml-3 text-[11px] font-mono text-text-muted">mission-control — live</span>
              <div className="ml-auto flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[10px] font-mono text-green-400/80">CONNECTED</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border-muted">
              <div className="p-5">
                <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-4">Agent Status</p>
                <div className="space-y-3">
                  {STATUS_AGENTS.map((a) => (
                    <div key={a.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${a.status === "active" ? "bg-green-400 animate-pulse" : "bg-text-muted opacity-40"}`} />
                        <span className="text-xs text-text-loud font-medium">{a.name}</span>
                      </div>
                      <span className="text-[10px] font-mono text-text-muted">{a.uptime}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-5">
                <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-4">Active Tasks</p>
                <div className="space-y-2.5 overflow-hidden">
                  {visibleTasks.map((task, i) => (
                    <motion.div
                      key={`${task}-${i}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, ease: easing.outExpo }}
                      className="flex items-start gap-2"
                    >
                      <span className="text-accent-blue-rest font-mono text-[10px] mt-0.5 shrink-0">&gt;</span>
                      <span className="text-xs text-text-secondary leading-relaxed">{task}</span>
                    </motion.div>
                  ))}
                  <div className="flex items-center gap-1 mt-1">
                    <span className="w-1.5 h-3 bg-accent-blue-rest animate-[type-cursor_1s_step-end_infinite]" />
                  </div>
                </div>
              </div>

              <div className="p-5">
                <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-4">Decision Log</p>
                <div className="space-y-3">
                  {DECISION_LOG.slice(0, 5).map((d, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.1 }}
                      className="group"
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[9px] font-mono text-text-muted">{d.time}</span>
                        <span className="text-[9px] font-mono text-accent-blue-rest opacity-60">{d.agent}</span>
                      </div>
                      <p className="text-xs text-text-secondary leading-snug">{d.msg}</p>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
