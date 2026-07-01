"use client";

import { motion } from "framer-motion";
import {
  Server, Shield, LockOpen, Boxes, KeyRound, Workflow,
  Rocket, Wallet, Check, Minus,
} from "lucide-react";
import { easing } from "@/lib/motion";
import { BRANDING } from "@/configs/branding";

/*
 * Competitor comparison as a ✓/— matrix (per reference design).
 * Closed AI-employee SaaS (Sintra, WorksBuddy, Lindy) rent you hosted bots —
 * convenient, but you never own the runtime or data. Self-hosting hands you
 * ownership but no managed runtime, updates, or support. SovereignML is the
 * ONLY column that is all-✓: the ownership of self-hosting with the convenience
 * of managed SaaS.
 *
 * Competitor cell values reflect publicly available positioning (researched
 * June 2026), as cited in the on-page footnote.
 */

const SOVEREIGN = "sovereign" as const;

const products = [
  { key: SOVEREIGN, name: BRANDING.name, tag: "AI operations layer" },
  { key: "sintra", name: "Sintra", tag: "Rented AI employees" },
  { key: "worksbuddy", name: "WorksBuddy", tag: "Closed assistant suite" },
  { key: "lindy", name: "Lindy", tag: "Hosted agent builder" },
  { key: "selfhost", name: "Self-hosting", tag: "DIY open source" },
] as const;

type ProductKey = (typeof products)[number]["key"];

/** true = supported, false = not, "partial" = limited (renders as — with a note) */
type Cell = true | false | "partial";

type Row = {
  feature: string;
  icon: typeof Server;
  badge?: string;
  values: Record<ProductKey, Cell>;
};

const rows: Row[] = [
  {
    feature: "Runs on your instance",
    icon: Server,
    values: { sovereign: true, sintra: false, worksbuddy: false, lindy: false, selfhost: true },
  },
  {
    feature: "You own & isolate all data",
    icon: Shield,
    values: { sovereign: true, sintra: false, worksbuddy: false, lindy: false, selfhost: true },
  },
  {
    feature: "No vendor lock-in",
    icon: LockOpen,
    values: { sovereign: true, sintra: false, worksbuddy: false, lindy: false, selfhost: true },
  },
  {
    feature: "Open agent runtime",
    icon: Boxes,
    values: { sovereign: true, sintra: false, worksbuddy: false, lindy: false, selfhost: true },
  },
  {
    feature: "Bring your own AI keys",
    icon: KeyRound,
    badge: "new",
    values: { sovereign: true, sintra: false, worksbuddy: false, lindy: "partial", selfhost: true },
  },
  {
    feature: "Native multi-agent orchestration",
    icon: Workflow,
    values: { sovereign: true, sintra: false, worksbuddy: false, lindy: "partial", selfhost: false },
  },
  {
    feature: "Managed deploy in minutes",
    icon: Rocket,
    values: { sovereign: true, sintra: true, worksbuddy: true, lindy: true, selfhost: false },
  },
  {
    feature: "No per-action credit metering",
    icon: Wallet,
    values: { sovereign: true, sintra: false, worksbuddy: false, lindy: false, selfhost: false },
  },
];

const cost: Record<ProductKey, string> = {
  sovereign: "From $9/mo",
  sintra: "~$97/mo",
  worksbuddy: "~$99/mo",
  lindy: "~$20/mo",
  selfhost: "Infra + your time",
};

/** A single matrix cell: a bold accent ✓ for supported (blue in light, lime in dark), a muted — for absent. */
function CellMark({ value }: { value: Cell }) {
  if (value === true) {
    return <Check className="mx-auto size-5 text-accent-blue-rest dark:text-signal" strokeWidth={3} aria-label="Yes" />;
  }
  if (value === "partial") {
    return (
      <span className="flex flex-col items-center gap-0.5">
        <Minus className="size-5 text-text-disabled" strokeWidth={2.5} aria-label="Limited" />
        <span className="text-[10px] leading-none text-text-disabled">limited</span>
      </span>
    );
  }
  return <Minus className="mx-auto size-5 text-text-disabled" strokeWidth={2.5} aria-label="No" />;
}

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
          <p className="text-text-secondary text-lg max-w-[560px] mx-auto">
            SaaS bots rent you seats. Self-hosting hands you a second job.
            {" "}{BRANDING.name} gives you both: the ownership of self-hosting with a
            fully managed runtime.
          </p>
        </motion.div>

        {/* Matrix — horizontally scrollable on small screens */}
        <motion.div
          initial={{ opacity: 0, y: 32, filter: "blur(4px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.1 }}
          transition={{ duration: 0.8, ease: easing.outExpo }}
          className="-mx-8 overflow-x-auto px-8 md:mx-0 md:overflow-visible md:px-0"
        >
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left">
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[14.8%]" />
              <col className="w-[14.8%]" />
              <col className="w-[14.8%]" />
              <col className="w-[14.8%]" />
              <col className="w-[14.8%]" />
            </colgroup>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-background align-bottom p-0" />
                {products.map((p) => {
                  const owned = p.key === SOVEREIGN;
                  return (
                    <th
                      key={p.key}
                      className="align-bottom p-0 text-center"
                    >
                      <div className="rounded-t-xl px-3 pb-5 pt-6">
                        <p
                          className={
                            "text-base font-semibold tracking-[-0.5px] " +
                            (owned ? "text-text-loud" : "text-text-muted")
                          }
                        >
                          {p.name}
                        </p>
                        <p className={"text-xs " + (owned ? "text-text-muted" : "text-text-disabled")}>
                          {p.tag}
                        </p>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const Icon = row.icon;
                return (
                  <tr key={row.feature} className="group">
                    {/* Feature label */}
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-b border-border-muted bg-background py-4 pl-7 pr-6 text-left align-middle font-normal transition-colors group-hover:rounded-l-lg group-hover:border-transparent group-hover:bg-text-loud/[0.04] [tr:has(+tr:hover)_&]:border-transparent"
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon className="size-4 shrink-0 text-text-muted" />
                        <span className="text-sm font-medium text-text-loud">
                          {row.feature}
                        </span>
                        {row.badge && (
                          <span className="rounded-full bg-accent-blue-rest/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-blue-rest">
                            {row.badge}
                          </span>
                        )}
                      </span>
                    </th>

                    {products.map((p, i) => (
                      <td
                        key={p.key}
                        className={
                          "border-b border-border-muted py-4 pl-3 text-center align-middle transition-colors group-hover:border-transparent group-hover:bg-text-loud/[0.04] [tr:has(+tr:hover)_&]:border-transparent " +
                          (i === products.length - 1 ? "pr-6 group-hover:rounded-r-lg" : "pr-3")
                        }
                      >
                        <CellMark value={row.values[p.key]} />
                      </td>
                    ))}
                  </tr>
                );
              })}

              {/* Cost row */}
              <tr className="group">
                <th
                  scope="row"
                  className="sticky left-0 z-10 rounded-bl-xl bg-background py-5 pl-7 pr-6 text-left align-middle font-normal transition-colors group-hover:rounded-l-lg group-hover:bg-text-loud/[0.04]"
                >
                  <span className="text-sm font-semibold text-text-loud">Cost</span>
                </th>
                {products.map((p, i) => {
                  const owned = p.key === SOVEREIGN;
                  return (
                    <td
                      key={p.key}
                      className={
                        "py-5 pl-3 text-center align-middle transition-colors group-hover:bg-text-loud/[0.04] " +
                        (i === products.length - 1 ? "rounded-br-xl pr-6 group-hover:rounded-r-lg" : "pr-3")
                      }
                    >
                      <span
                        className={
                          "text-sm " +
                          (owned
                            ? "font-bold text-accent-blue-rest dark:text-signal"
                            : "font-medium text-text-muted")
                        }
                      >
                        {cost[p.key]}
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </motion.div>

        {/* Footnote */}
        <div className="mt-10 flex flex-col items-center">
          <p className="text-center text-xs text-text-muted max-w-[480px]">
            Comparison reflects publicly available positioning, June 2026.
            Competitor names are trademarks of their respective owners.
          </p>
        </div>
      </div>
    </section>
  );
}
