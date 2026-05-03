"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

interface FloatingDotsProps {
  count?: number;
  className?: string;
  converge?: boolean;
  color?: string;
}

export function FloatingDots({
  count = 40,
  className,
  converge = false,
  color = "var(--color-primary)",
}: FloatingDotsProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dots = useMemo(() => {
    if (!mounted) return [];
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      startX: Math.random() * 100,
      startY: Math.random() * 100,
      size: Math.random() * 3 + 1,
      delay: Math.random() * 5,
      duration: Math.random() * 8 + 12,
    }));
  }, [count, mounted]);

  if (!mounted) return null;

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
            converge
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
          transition={{
            duration: dot.duration,
            delay: dot.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
