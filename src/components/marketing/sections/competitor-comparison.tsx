"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Server, LockOpen, Boxes, Shield, Layers, Workflow, Download,
} from "lucide-react";
import { easing } from "@/lib/motion";
import { BRANDING } from "@/configs/branding";

/*
 * Competitor comparison as a "datasheet", not a ✓/✗ matrix.
 * Closed AI-employee SaaS (Sintra, WorkBuddy, Lindy) rent you seats to hosted
 * bots; SovereignML hands you an operations layer you own. The differentiator
 * is ownership and portability, so every cell carries a specific spec value
 * rather than a checkmark, and SovereignML is the only solid, "owned" column.
 *
 * {{TODO: competitor cell values reflect publicly available positioning and
 * should be confirmed by marketing/legal before this ships publicly.}}
 */

const competitors = [
  { key: "sintra", name: "Sintra", tag: "Rented AI employees" },
  { key: "workbuddy", name: "WorksBuddy", tag: "Closed AI assistant" },
  { key: "lindy", name: "Lindy", tag: "Hosted agent builder" },
] as const;

type CompetitorKey = (typeof competitors)[number]["key"];

type Row = {
  dimension: string;
  icon: typeof Server;
  sovereign: string;
  others: string; // mobile reduction — the shared competitor stance
  values: Record<CompetitorKey, { text: string; weak?: boolean }>;
};

const rows: Row[] = [
  {
    dimension: "Where it runs",
    icon: Server,
    sovereign: "Your private instance",
    others: "Vendor cloud",
    values: {
      sintra: { text: "Vendor cloud" },
      workbuddy: { text: "Vendor cloud" },
      lindy: { text: "Vendor cloud" },
    },
  },
  {
    dimension: "Vendor lock-in",
    icon: LockOpen,
    sovereign: "None — leave anytime",
    others: "Locked to platform",
    values: {
      sintra: { text: "Locked in", weak: true },
      workbuddy: { text: "Locked in", weak: true },
      lindy: { text: "Locked in", weak: true },
    },
  },
  {
    dimension: "Agent runtime",
    icon: Boxes,
    sovereign: "Open · OpenClaw / Hermes",
    others: "Closed, proprietary",
    values: {
      sintra: { text: "Closed", weak: true },
      workbuddy: { text: "Closed", weak: true },
      lindy: { text: "Closed", weak: true },
    },
  },
  {
    dimension: "Your data",
    icon: Shield,
    sovereign: "Isolated to you",
    others: "On vendor cloud",
    values: {
      sintra: { text: "On vendor cloud" },
      workbuddy: { text: "On vendor cloud" },
      lindy: { text: "On vendor cloud" },
    },
  },
  {
    dimension: "Agent types",
    icon: Layers,
    sovereign: "Any type, fully custom",
    others: "Preset roster",
    values: {
      sintra: { text: "Fixed bot roster" },
      workbuddy: { text: "Preset assistants" },
      lindy: { text: "Hosted builder" },
    },
  },
  {
    dimension: "Multi-agent orchestration",
    icon: Workflow,
    sovereign: "Native",
    others: "Limited",
    values: {
      sintra: { text: "Not supported", weak: true },
      workbuddy: { text: "Not supported", weak: true },
      lindy: { text: "Partial" },
    },
  },
  {
    dimension: "Take it with you",
    icon: Download,
    sovereign: "Full config export",
    others: "Not available",
    values: {
      sintra: { text: "Not available", weak: true },
      workbuddy: { text: "Not available", weak: true },
      lindy: { text: "Not available", weak: true },
    },
  },
];

export function CompetitorComparison() {
  return (
    <section
      id="comparison"
      aria-label="How SovereignML compares to other AI agent platforms"
      className="relative py-32 overflow-hidden"
    >
      <div className="max-w-[1150px] mx-auto px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 48, filter: "blur(4px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.8, ease: easing.outExpo }}
          className="text-center mb-14"
        >
          <p className="text-xs text-accent-blue-rest uppercase tracking-[0.2em] mb-4 font-medium">
            How we compare
          </p>
          <h2 className="text-[clamp(2rem,4vw,48px)] font-bold text-text-loud tracking-[-1.5px] mb-5">
            They rent you bots. You own the whole stack.
          </h2>
          <p className="text-text-secondary text-lg max-w-[520px] mx-auto">
            Most AI-employee tools keep your agents, data, and runtime on their cloud. SovereignML hands you the operations layer — and lets you walk away with it.
          </p>
        </motion.div>

        {/* ── Desktop: datasheet table ── */}
        <motion.div
          initial={{ opacity: 0, y: 32, filter: "blur(4px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.1 }}
          transition={{ duration: 0.8, ease: easing.outExpo }}
          className="hidden md:block"
        >
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th className="w-[26%] align-bottom p-0" />
                {/* SovereignML — the owned column */}
                <th className="w-[22%] align-bottom p-0">
                  <div className="rounded-t-2xl border-x border-t border-accent-blue-rest/25 bg-card-full px-5 pt-4 pb-4 border-t-[3px] border-t-signal">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent-blue-rest">
                      Yours to own
                    </span>
                    <p className="mt-1 text-lg font-bold tracking-[-0.5px] text-text-loud">
                      {BRANDING.name}
                    </p>
                    <p className="text-xs text-text-muted">AI operations layer</p>
                  </div>
                </th>
                {competitors.map((c) => (
                  <th key={c.key} className="w-[17.3%] align-bottom p-0">
                    <div className="px-5 pb-4 pt-6">
                      <p className="text-lg font-semibold tracking-[-0.5px] text-text-muted">
                        {c.name}
                      </p>
                      <p className="text-xs text-text-disabled">{c.tag}</p>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const Icon = row.icon;
                const last = i === rows.length - 1;
                return (
                  <tr key={row.dimension} className="group">
                    {/* Dimension label */}
                    <th
                      scope="row"
                      className="border-b border-border-muted py-4 pr-6 text-left align-middle font-normal"
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon className="size-4 shrink-0 text-text-muted" />
                        <span className="text-sm font-medium text-text-loud">
                          {row.dimension}
                        </span>
                      </span>
                    </th>

                    {/* SovereignML cell — continuous solid column */}
                    <td
                      className={
                        "border-x border-accent-blue-rest/25 bg-card-full px-5 py-4 align-middle " +
                        (last ? "rounded-b-2xl border-b" : "")
                      }
                    >
                      <span className="flex items-center gap-2">
                        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent-blue-rest/10">
                          <span className="size-1.5 rounded-full bg-accent-blue-rest" />
                        </span>
                        <span className="text-sm font-semibold text-text-loud">
                          {row.sovereign}
                        </span>
                      </span>
                    </td>

                    {/* Competitor cells */}
                    {competitors.map((c) => {
                      const cell = row.values[c.key];
                      return (
                        <td
                          key={c.key}
                          className="border-b border-border-muted px-5 py-4 align-middle"
                        >
                          <span
                            className={
                              "text-sm " +
                              (cell.weak
                                ? "text-text-disabled line-through decoration-text-disabled/40"
                                : "text-text-muted")
                            }
                          >
                            {cell.text}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-8 flex items-center justify-between gap-4">
            <p className="text-xs text-text-muted max-w-[440px]">
              Comparison reflects publicly available positioning, June 2026. Competitor names are trademarks of their respective owners.
            </p>
            <Link href="/login?deploy=true" className="btn-green text-base shrink-0">
              Deploy your first agent
            </Link>
          </div>
        </motion.div>

        {/* ── Mobile: SovereignML vs the field ── */}
        <div className="md:hidden">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-accent-blue-rest/25 bg-card-full p-4 border-t-[3px] border-t-signal">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent-blue-rest">
                Yours to own
              </span>
              <p className="mt-1 text-base font-bold text-text-loud">{BRANDING.name}</p>
            </div>
            <div className="rounded-2xl border border-border-muted p-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                The field
              </span>
              <p className="mt-1 text-sm font-semibold text-text-muted leading-tight">
                Sintra · WorksBuddy · Lindy
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {rows.map((row) => {
              const Icon = row.icon;
              return (
                <div
                  key={row.dimension}
                  className="rounded-2xl border border-border-muted bg-background-faint p-4"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <Icon className="size-4 text-text-muted" />
                    <span className="text-sm font-medium text-text-loud">
                      {row.dimension}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2">
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent-blue-rest/10">
                        <span className="size-1.5 rounded-full bg-accent-blue-rest" />
                      </span>
                      <span className="text-sm font-semibold text-text-loud">
                        {row.sovereign}
                      </span>
                    </div>
                    <span className="text-sm text-text-disabled">{row.others}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <Link
            href="/login?deploy=true"
            className="btn-green text-base mt-6 inline-flex w-full justify-center"
          >
            Deploy your first agent
          </Link>
          <p className="mt-4 text-xs text-text-muted">
            Comparison reflects publicly available positioning, June 2026. Competitor names are trademarks of their respective owners.
          </p>
        </div>
      </div>
    </section>
  );
}
