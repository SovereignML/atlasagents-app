"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

interface DrawLineProps {
  className?: string;
  direction?: "vertical" | "horizontal";
  color?: string;
  thickness?: number;
}

export function DrawLine({
  className,
  direction = "vertical",
  color = "var(--color-primary)",
  thickness = 2,
}: DrawLineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ref = useRef<SVGSVGElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 0.8", "end 0.2"],
  });

  const pathLength = useTransform(scrollYProgress, [0, 1], [0, 1]);

  const isVertical = direction === "vertical";
  const viewBox = isVertical ? "0 0 2 100" : "0 0 100 2";
  const d = isVertical ? "M1 0 L1 100" : "M0 1 L100 1";

  return (
    <div ref={containerRef} className={className} style={{
      width: isVertical ? `${thickness}px` : "100%",
      height: isVertical ? "100%" : `${thickness}px`,
    }}>
    <svg
      ref={ref}
      viewBox={viewBox}
      preserveAspectRatio="none"
      style={{ width: "100%", height: "100%" }}
    >
      <motion.path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={isVertical ? 2 : 2}
        style={{ pathLength }}
        strokeLinecap="round"
      />
    </svg>
    </div>
  );
}
