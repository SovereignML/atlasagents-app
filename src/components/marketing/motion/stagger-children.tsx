"use client";

import { motion } from "framer-motion";
import { easing, staggerDelay } from "@/lib/motion";

interface StaggerChildrenProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  stagger?: keyof typeof staggerDelay;
}

const container = (stagger: number, delay: number) => ({
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: stagger,
      delayChildren: delay,
    },
  },
});

export const staggerItem = {
  hidden: { opacity: 0, y: 30 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: easing.outExpo },
  },
};

export function StaggerChildren({
  children,
  className,
  delay = 0,
  stagger = "medium",
}: StaggerChildrenProps) {
  return (
    <motion.div
      variants={container(staggerDelay[stagger], delay)}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
