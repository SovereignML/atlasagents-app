"use client";

import { motion } from "framer-motion";
import { easing } from "@/lib/motion";
import { RevealGroup, RevealItem } from "@/components/marketing/motion/reveal";

/*
 * "Part of" / "Backed by" program strip.
 *
 * INTEGRITY GATE: Do NOT render this section until each program membership is
 * confirmed AND the official logo asset is in place. It is intentionally left
 * un-rendered in src/app/page.tsx — flip it on once the items below are real.
 *
 * For each confirmed program:
 *   1. Set `confirmed: true`
 *   2. Drop the official logo into public/assets/backed-by/<slug>.avif
 *      (+ <slug>-dark.avif if a dark-mode variant is needed)
 * Only entries with `confirmed: true` AND a logo path render.
 *
 * {{TODO: confirm each membership before enabling}}
 */
type Program = {
  slug: string;
  name: string;
  confirmed: boolean;
  hasDark?: boolean;
};

const PROGRAMS: Program[] = [
  { slug: "nvidia-inception", name: "NVIDIA Inception", confirmed: false }, // {{TODO: confirm membership + logo}}
  { slug: "cloudflare-startups", name: "Cloudflare for Startups", confirmed: false }, // {{TODO}}
  { slug: "microsoft-startups", name: "Microsoft for Startups", confirmed: false }, // {{TODO}}
  { slug: "ovhcloud-startup", name: "OVHcloud Startup Program", confirmed: false }, // {{TODO}}
  { slug: "digitalocean-hatch", name: "DigitalOcean Hatch", confirmed: false }, // {{TODO}}
];

export function BackedBy() {
  const visible = PROGRAMS.filter((p) => p.confirmed);
  if (visible.length === 0) return null;

  return (
    <section className="relative py-24 overflow-hidden">
      <div className="max-w-[1100px] mx-auto px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 24, filter: "blur(4px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.8, ease: easing.outExpo }}
          className="text-center mb-10"
        >
          <p className="text-xs text-text-secondary uppercase tracking-[0.2em] font-medium">Part of</p>
        </motion.div>

        <RevealGroup className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8">
          {visible.map((p) => (
            <RevealItem key={p.slug} className="opacity-70 hover:opacity-100 transition-opacity">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                decoding="async"
                alt={p.name}
                className={`h-8 w-auto${p.hasDark ? " dark:hidden" : ""}`}
                loading="lazy"
                src={`/assets/backed-by/${p.slug}.avif`}
              />
              {p.hasDark && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  decoding="async"
                  alt={p.name}
                  className="h-8 w-auto hidden dark:block"
                  loading="lazy"
                  src={`/assets/backed-by/${p.slug}-dark.avif`}
                />
              )}
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
