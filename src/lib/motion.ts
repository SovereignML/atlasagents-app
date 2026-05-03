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

export const duration = { fast: 0.3, medium: 0.6, slow: 1.0 };

export const staggerDelay = {
  fast: 0.05,
  medium: 0.08,
  slow: 0.12,
};

export const viewport = {
  once: { once: true, amount: 0.3 },
  repeat: { amount: 0.1 },
  half: { once: true, amount: 0.5 },
};

export const morphTransition = {
  duration: 1.2,
  ease: [0.16, 1, 0.3, 1] as const,
};

export function parallaxRange(
  scrollProgress: readonly [number, number],
  outputRange: readonly [number, number]
): { input: readonly [number, number]; output: readonly [number, number] } {
  return { input: scrollProgress, output: outputRange };
}
