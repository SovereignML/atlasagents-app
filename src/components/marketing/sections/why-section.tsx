"use client";

import { motion, useReducedMotion } from "framer-motion";
import { easing } from "@/lib/motion";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

const WHY_CARDS = [
  {
    title: "Built for the real world.",
    description:
      "AI doesn't live in slides or sandboxes. SovereignML was designed to handle real conversations, real data, and real operations, without breaking when things get complex.",
  },
  {
    title: "Engineered for longevity.",
    description:
      "SovereignML isn't built for trends. It's built to be fast, modular, and designed to evolve with how businesses leverage AI in the next decade.",
  },
  {
    title: "Transparent by design.",
    description:
      "You deserve to understand how your AI works. SovereignML's logic is visible, editable, and accountable, so you can always stay in control.",
  },
  {
    title: "Grounded in truth.",
    description:
      "Every answer comes from your own data, not from hallucinated guesses. SovereignML connects to the systems that define your business, keeping responses accurate and trustworthy.",
  },
  {
    title: "Autonomy with responsibility.",
    description:
      "Automation should serve people, not erase them. SovereignML handles the routine, learns from outcomes, and involves humans if required.",
  },
];

const getCardPositionClass = (index: number) => {
  switch (index) {
    case 0:
      return "lg:absolute lg:left-[38%] lg:top-[-2%] lg:rotate-[-2deg]";
    case 1:
      return "lg:absolute lg:left-[2%] lg:top-[30%] lg:rotate-[-6deg]";
    case 2:
      return "lg:absolute lg:right-[3%] lg:top-[10%] lg:rotate-[-4deg]";
    case 3:
      return "lg:absolute lg:left-[8%] lg:top-[2%] lg:rotate-[-7deg]";
    case 4:
      return "lg:absolute lg:bottom-[30%] lg:right-[2%] lg:rotate-[-5deg]";
    default:
      return "";
  }
};

export function WhySection() {
  const { resolvedTheme } = useTheme();
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [stars, setStars] = useState<{ id: number; size: number; left: string; top: string; delay: number; duration: number }[]>([]);

  useEffect(() => {
    // Intentional mount-time init: the theme mount-gate and the client-only
    // random star field (computed here to avoid SSR hydration mismatch) both
    // require setting state once after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    // Generate stars only on the client side to avoid SSR hydration mismatches
    const generatedStars = Array.from({ length: 45 }).map((_, i) => ({
      id: i,
      size: Math.random() * 2 + 0.8,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      delay: Math.random() * 5,
      duration: Math.random() * 4 + 3,
    }));
    setStars(generatedStars);
  }, []);

  const isDark = !mounted || resolvedTheme === "dark";

  return (
    <section id="why" className="relative py-32 lg:py-48 overflow-hidden bg-[#f8f9fc] dark:bg-[#030308] transition-colors duration-300">
      {/* Background Star Field */}
      <div className="absolute inset-0 pointer-events-none z-0">
        {stars.map((star) => (
          <motion.div
            key={star.id}
            className="absolute bg-[#015efe]/25 dark:bg-white rounded-full transition-colors duration-300"
            style={{
              width: star.size,
              height: star.size,
              left: star.left,
              top: star.top,
            }}
            animate={reduceMotion ? { opacity: 0.5 } : { opacity: [0.1, 0.8, 0.1] }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    duration: star.duration,
                    repeat: Infinity,
                    delay: star.delay,
                    ease: "easeInOut",
                  }
            }
          />
        ))}
      </div>

      {/* Planetary Curve at the Bottom */}
      <div 
        className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[85%] w-[150%] aspect-square rounded-[50%] bg-[#f0f4fa] dark:bg-[#080c1a] border-t border-black/5 dark:border-white/10 z-10 shadow-[0_-20px_50px_rgba(1,94,254,0.08)] dark:shadow-[0_-20px_50px_rgba(30,58,138,0.25)] transition-all duration-300"
        style={{
          boxShadow: isDark 
            ? "inset 0 1px 0 rgba(255, 255, 255, 0.05)" 
            : "inset 0 1px 0 rgba(255, 255, 255, 0.4)"
        }}
      />

      <div className="max-w-[1200px] mx-auto px-6 relative z-10">
        <div className="relative w-full flex flex-col items-center">
          
          {/* Background logo glow & glass elements */}
          <div className="absolute left-1/2 top-[30%] lg:top-[35%] -translate-x-1/2 -translate-y-1/2 w-[min(90vw,600px)] aspect-square pointer-events-none z-0 opacity-25 dark:opacity-40 transition-opacity duration-300">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.22)_0%,transparent_70%)] blur-3xl" />
            <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full drop-shadow-[0_0_50px_rgba(59,130,246,0.25)]">
              <defs>
                <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={isDark ? "#ffffff" : "#015efe"} stopOpacity={isDark ? 0.25 : 0.20}/>
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.03"/>
                </linearGradient>
                <linearGradient id="sGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={isDark ? "#60a5fa" : "#015efe"}/>
                  <stop offset="100%" stopColor="#3b82f6"/>
                </linearGradient>
              </defs>
              <motion.circle 
                cx="100" 
                cy="100" 
                r="82" 
                stroke="url(#ringGrad)" 
                strokeWidth="1.5" 
                strokeDasharray="4 12"
                animate={reduceMotion ? undefined : { rotate: 360 }}
                transition={reduceMotion ? undefined : { duration: 150, repeat: Infinity, ease: "linear" }}
                style={{ originX: "100px", originY: "100px" }}
              />
              <circle cx="100" cy="100" r="74" stroke="url(#ringGrad)" strokeWidth="0.5" strokeOpacity="0.3" />
              <circle cx="100" cy="100" r="62" fill={isDark ? "white" : "#015efe"} fillOpacity={isDark ? 0.015 : 0.01} stroke={isDark ? "white" : "#015efe"} strokeOpacity={isDark ? 0.06 : 0.08} strokeWidth="0.8" />
              {/* Glowing sovereign crest */}
              <path d="M70 85 C70 68, 85 58, 100 58 C115 58, 130 68, 130 85 C130 108, 70 102, 70 118 C70 132, 85 142, 100 142 C115 142, 130 132, 130 115" stroke="url(#sGrad)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Giant Background 'Why?' */}
          <span 
            className="text-[clamp(120px,18.5vw,280px)] font-bold tracking-tight text-center leading-[1.77] select-none pointer-events-none absolute left-1/2 -translate-x-1/2 top-[10%] lg:top-[5%] z-0 font-serif transition-all duration-300"
            style={{
              background: isDark
                ? "linear-gradient(180deg, rgba(0, 0, 0, 0.08), rgba(2, 23, 54, 0.9) 25%, #d8e7fd 50%, rgba(2, 23, 54, 0.9) 75%, rgba(0, 0, 0, 0.08))"
                : "linear-gradient(180deg, rgba(27, 37, 64, 0.03), rgba(27, 37, 64, 0.15) 25%, #015efe 50%, rgba(27, 37, 64, 0.15) 75%, rgba(27, 37, 64, 0.03))",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              textShadow: isDark 
                ? "0 0 240px #0745a2" 
                : "0 0 240px rgba(1, 94, 254, 0.15)",
              WebkitTextFillColor: "transparent",
              WebkitTextStrokeWidth: "1px",
              WebkitTextStrokeColor: isDark 
                ? "hsla(0,0%,100%,.15)" 
                : "rgba(12, 38, 77, 0.12)",
            }}
          >
            Why?
          </span>

          {/* Floating Cards Container */}
          <div className="w-full relative mt-16 lg:mt-0 min-h-none lg:min-h-[580px] z-20 grid grid-cols-1 md:grid-cols-2 lg:block gap-6">
            {WHY_CARDS.map((card, index) => {
              const cardShadow = isDark
                ? "0 12px 16px -5px rgba(0,0,0,0.24), 0 8px 12px -4px rgba(0,0,0,0.2), inset 0 -1px rgba(0,0,0,0.16), inset 0 1px rgba(255,255,255,0.32)"
                : "0 12px 16px -5px rgba(12,38,77,0.06), 0 8px 12px -4px rgba(12,38,77,0.04), inset 0 -1px rgba(12,38,77,0.04), inset 0 1px rgba(255,255,255,0.9)";

              const hoverShadow = isDark
                ? "0 20px 25px -5px rgba(0,0,0,0.5), 0 10px 10px -5px rgba(0,0,0,0.4), inset 0 -1px rgba(0,0,0,0.16), inset 0 1px rgba(255,255,255,0.45)"
                : "0 20px 25px -5px rgba(12,38,77,0.12), 0 10px 10px -5px rgba(12,38,77,0.08), inset 0 -1px rgba(12,38,77,0.06), inset 0 1px rgba(255,255,255,1)";

              return (
                <div
                  key={index}
                  className={`w-full relative lg:absolute lg:w-[min(30vw,440px)] ${getCardPositionClass(index)}`}
                >
                  <motion.div
                    initial={{ opacity: 0, y: 48, scale: 0.95 }}
                    whileInView={{ opacity: 1, y: 0, scale: 1 }}
                    viewport={{ once: true, amount: 0.15 }}
                    transition={{ duration: 0.8, delay: index * 0.1, ease: easing.outExpo }}
                    whileHover={{ 
                      y: -6,
                      scale: 1.015,
                      boxShadow: hoverShadow,
                      transition: { duration: 0.3, ease: "easeOut" }
                    }}
                    className="bg-white/80 dark:bg-[#1c1c1c] border border-[#015efe]/10 dark:border-white/5 rounded-2xl p-6 flex flex-col gap-3 relative transition-all duration-300 backdrop-blur-md group cursor-default"
                    style={{
                      boxShadow: cardShadow
                    }}
                  >
                    <h3 className="text-text-loud dark:text-white font-bold text-[clamp(16px,1.2vw,18px)] leading-snug tracking-tight">
                      {card.title}
                    </h3>
                    <p className="text-text-secondary dark:text-white/60 text-[clamp(13px,0.93vw,14px)] leading-relaxed">
                      {card.description}
                    </p>
                  </motion.div>
                </div>
              );
            })}
          </div>

        </div>
      </div>
    </section>
  );
}
