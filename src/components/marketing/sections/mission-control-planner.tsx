"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { easing } from "@/lib/motion";

// Illustrative figures for the dashboard mockup (not live data).
const STATUS_AGENTS = [
  { name: "Support Agent", status: "active", uptime: "99.97%", load: 72 },
  { name: "DevOps Agent", status: "active", uptime: "99.99%", load: 41 },
  { name: "Sales Agent", status: "active", uptime: "99.94%", load: 58 },
  { name: "Content Agent", status: "idle", uptime: "99.95%", load: 12 },
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

// Static bar heights for the throughput sparkline (percent of track height).
const SPARK = [38, 52, 44, 61, 49, 73, 58, 81, 66, 92, 74, 88];

export function MissionControlPlanner() {
  const reduceMotion = useReducedMotion();
  const [visibleTasks, setVisibleTasks] = useState(TASK_FEED.slice(0, 5));
  const taskIndex = useRef(5);

  // Live "resolved today" counter — starts from a stable base (SSR-safe) and
  // ticks up after mount so the board feels live without a hydration mismatch.
  const [resolved, setResolved] = useState(1284);

  const rotateTasks = useCallback(() => {
    setVisibleTasks((prev) => {
      const next = [...prev.slice(1), TASK_FEED[taskIndex.current % TASK_FEED.length]];
      taskIndex.current++;
      return next;
    });
    setResolved((n) => n + 1);
  }, []);

  useEffect(() => {
    // Respect "Reduce Motion": keep the feed and counter static.
    if (reduceMotion) return;
    const interval = setInterval(rotateTasks, 2800);
    return () => clearInterval(interval);
  }, [rotateTasks, reduceMotion]);

  const metrics = [
    { label: "Resolved today", value: resolved.toLocaleString(), live: true },
    { label: "Avg resolution", value: "38s" },
    { label: "Agents active", value: "3 / 4" },
    { label: "Fleet uptime", value: "99.97%" },
  ];

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
            Watch every task, decision, and health check as it happens.
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
            {/* Console title bar */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border-muted">
              <div className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
              <span className="ml-3 text-[11px] font-mono text-text-muted">mission-control: live</span>
              <div className="ml-auto flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[10px] font-mono text-green-400/80">CONNECTED</span>
              </div>
            </div>

            {/* Metric strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border-muted border-b border-border-muted">
              {metrics.map((m) => (
                <div key={m.label} className="px-5 py-4">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-1.5">{m.label}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold tracking-[-1px] text-text-loud tabular-nums">{m.value}</span>
                    {m.live && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent-blue-rest/10 px-1.5 py-0.5">
                        <span className="size-1 rounded-full bg-accent-blue-rest animate-pulse" />
                        <span className="text-[9px] font-mono uppercase text-accent-blue-rest">live</span>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Board: roster · live stream · decision log */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,240px)_minmax(0,1.5fr)_minmax(0,1fr)] divide-y lg:divide-y-0 lg:divide-x divide-border-muted">
              {/* Agent roster with utilization bars */}
              <div className="p-5">
                <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-4">Agent Roster</p>
                <div className="space-y-4">
                  {STATUS_AGENTS.map((a) => (
                    <div key={a.name}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full ${a.status === "active" ? "bg-green-400 animate-pulse" : "bg-text-muted opacity-40"}`} />
                          <span className="text-xs text-text-loud font-medium">{a.name}</span>
                        </div>
                        <span className="text-[10px] font-mono text-text-muted">{a.uptime}</span>
                      </div>
                      <div className="h-1 rounded-full bg-background-loud overflow-hidden">
                        <motion.div
                          className={`h-full rounded-full ${a.status === "active" ? "bg-accent-blue-rest" : "bg-text-muted/40"}`}
                          initial={{ width: 0 }}
                          whileInView={{ width: `${a.load}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.9, ease: easing.outExpo }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Throughput sparkline */}
                <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mt-6 mb-3">Throughput / min</p>
                <div className="flex items-end gap-1 h-12">
                  {SPARK.map((h, i) => (
                    <motion.span
                      key={i}
                      className="flex-1 rounded-sm bg-accent-blue-rest/30"
                      initial={{ height: 0 }}
                      whileInView={{ height: `${h}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.6, delay: i * 0.03, ease: easing.outExpo }}
                    />
                  ))}
                </div>
              </div>

              {/* Live task stream — the dominant pane */}
              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Live Task Stream</p>
                  <span className="text-[10px] font-mono text-accent-blue-rest/70">tail -f</span>
                </div>
                <div className="space-y-3 overflow-hidden">
                  {visibleTasks.map((task, i) => (
                    <motion.div
                      key={`${task}-${i}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, ease: easing.outExpo }}
                      className="flex items-start gap-2.5 rounded-lg border border-border-muted bg-background-faint px-3 py-2"
                    >
                      <span className="text-accent-blue-rest font-mono text-[10px] mt-0.5 shrink-0">&gt;</span>
                      <span className="text-xs text-text-secondary leading-relaxed">{task}</span>
                    </motion.div>
                  ))}
                  <div className="flex items-center gap-1 mt-1 pl-1">
                    <span className="w-1.5 h-3 bg-accent-blue-rest animate-[type-cursor_1s_step-end_infinite]" />
                  </div>
                </div>
              </div>

              {/* Decision log */}
              <div className="p-5">
                <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-4">Decision Log</p>
                <div className="relative space-y-4 pl-4">
                  <span aria-hidden className="absolute left-[3px] top-1 bottom-1 w-px bg-border-muted" />
                  {DECISION_LOG.slice(0, 5).map((d, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.1 }}
                      className="relative"
                    >
                      <span aria-hidden className="absolute -left-4 top-1 size-1.5 rounded-full bg-accent-blue-rest" />
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
