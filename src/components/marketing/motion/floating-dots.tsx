"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

interface FloatingDotsProps {
  count?: number;
  className?: string;
  converge?: boolean;
  color?: string;
}

type Dot = {
  id: number;
  startX: number;
  startY: number;
  size: number;
  delay: number;
  duration: number;
};

export function FloatingDots({
  count = 40,
  className,
  converge = false,
  color = "var(--color-accent-blue-rest)",
}: FloatingDotsProps) {
  // Generate the random dots in an effect (client-only) rather than during
  // render — Math.random() is impure and would both trip react-hooks/purity
  // and cause SSR hydration mismatches.
  const [dots, setDots] = useState<Dot[]>([]);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    // Client-only random init after mount (avoids SSR hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDots(
      Array.from({ length: count }, (_, i) => ({
        id: i,
        startX: Math.random() * 100,
        startY: Math.random() * 100,
        size: Math.random() * 3 + 1,
        delay: Math.random() * 5,
        duration: Math.random() * 8 + 12,
      })),
    );
  }, [count]);

  if (dots.length === 0) return null;

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className ?? ""}`}>
      {dots.map((dot) => (
        <motion.div
          key={dot.id}
          className="absolute rounded-full"
          style={{
            width: dot.size,
            height: dot.size,
            backgroundColor: color,
            opacity: 0.15,
            left: `${dot.startX}%`,
            top: `${dot.startY}%`,
          }}
          animate={
            reduceMotion
              ? { opacity: 0.2 }
              : converge
                ? {
                    left: "50%",
                    top: "50%",
                    opacity: [0.15, 0.4, 0],
                  }
                : {
                    y: [0, -20, 0],
                    x: [0, 10, 0],
                    opacity: [0.15, 0.3, 0.15],
                  }
          }
          transition={
            reduceMotion
              ? { duration: 0 }
              : {
                  duration: dot.duration,
                  delay: dot.delay,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
          }
        />
      ))}
    </div>
  );
}
