"use client";

export const easing = {
  outExpo: [0.16, 1, 0.3, 1] as const,
  inOutCubic: [0.65, 0, 0.35, 1] as const,
  outQuart: [0.25, 1, 0.5, 1] as const,
};

export const spring = {
  snappy: { type: "spring" as const, stiffness: 300, damping: 30 },
  gentle: { type: "spring" as const, stiffness: 120, damping: 20 },
  bouncy: { type: "spring" as const, stiffness: 400, damping: 25 },
};

export const duration = { fast: 0.3, medium: 0.8, slow: 1.0 };

export const staggerDelay = {
  fast: 0.05,
  medium: 0.08,
  slow: 0.12,
};

export const viewport = {
  once: { once: true, amount: 0.15 },
  repeat: { amount: 0.1 },
  half: { once: true, amount: 0.5 },
};

export const morphTransition = {
  duration: 1.2,
  ease: [0.16, 1, 0.3, 1] as const,
};

// Shared entrance variants used by <Reveal> / <RevealGroup>. Pulls the
// site-wide "fade up + de-blur" pattern into one place so every section reads
// the same. Wrap consumers in <MotionConfig reducedMotion="user"> so the
// transform/blur is dropped (opacity kept) when the OS requests reduced motion.
export const revealVariants = {
  hidden: { opacity: 0, y: 24, filter: "blur(4px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.7, ease: easing.outExpo },
  },
};

// Container variant: children inherit `revealVariants` and reveal in sequence.
export const revealGroupVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: staggerDelay.medium },
  },
};

export function parallaxRange(
  scrollProgress: readonly [number, number],
  outputRange: readonly [number, number]
): { input: readonly [number, number]; output: readonly [number, number] } {
  return { input: scrollProgress, output: outputRange };
}
