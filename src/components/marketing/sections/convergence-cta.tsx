"use client";

import Link from "next/link";
import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { MagneticButton } from "@/components/marketing/motion/magnetic-button";
import { FloatingDots } from "@/components/marketing/motion/floating-dots";
import { BRANDING } from "@/configs/branding";

export function ConvergenceCTA() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start 0.8", "end end"],
  });

  const headlineOpacity = useTransform(scrollYProgress, [0, 0.4], [0, 1]);
  const headlineY = useTransform(scrollYProgress, [0, 0.4], [30, 0]);
  const subOpacity = useTransform(scrollYProgress, [0.2, 0.5], [0, 1]);
  const ctaOpacity = useTransform(scrollYProgress, [0.35, 0.6], [0, 1]);
  const ctaY = useTransform(scrollYProgress, [0.35, 0.6], [20, 0]);

  return (
    <section ref={sectionRef} className="relative py-40 overflow-hidden">
      <FloatingDots count={40} converge />

      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-accent-blue-rest opacity-[0.04] blur-[100px] rounded-full pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-accent-blue-rest opacity-[0.03] blur-[120px] pointer-events-none" />

      <div className="relative z-10 max-w-[700px] mx-auto px-8 text-center">
        <motion.h2
          style={{ opacity: headlineOpacity, y: headlineY }}
          className="text-[clamp(2rem,4.5vw,48px)] font-bold text-text-loud tracking-[-1.5px] mb-5 leading-tight"
        >
          Stop managing tasks.<br />Start deploying agents.
        </motion.h2>

        <motion.p
          style={{ opacity: subOpacity }}
          className="text-lg text-text-secondary mb-10 max-w-md mx-auto"
        >
          OpenClaw or Hermes: pick a runtime and go live in minutes.
        </motion.p>

        <motion.div
          style={{ opacity: ctaOpacity, y: ctaY }}
          className="inline-flex glass rounded-full p-1.5 gap-2"
        >
          <MagneticButton>
            <Link href="/login?deploy=true" className="btn-green text-sm px-8 py-3.5">
              Deploy Now
            </Link>
          </MagneticButton>
          <MagneticButton>
            <a
              href={BRANDING.demoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-8 py-3.5 text-sm font-semibold text-text-loud rounded-full hover:bg-background-faint transition-colors"
            >
              Book a Demo
            </a>
          </MagneticButton>
        </motion.div>
      </div>
    </section>
  );
}
