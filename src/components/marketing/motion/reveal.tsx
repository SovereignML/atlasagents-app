"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { revealVariants, revealGroupVariants, viewport } from "@/lib/motion";

type MotionTag =
  | "div"
  | "section"
  | "li"
  | "ul"
  | "span"
  | "header"
  | "article"
  | "h1"
  | "h2"
  | "h3"
  | "p"
  | "nav"
  | "footer";

interface RevealProps extends HTMLMotionProps<"div"> {
  /** Extra delay (s) before this element reveals — handy outside a RevealGroup. */
  delay?: number;
  /** Vertical travel distance (px). Defaults to the shared 24px. */
  y?: number;
  /** Render as a different element while keeping the motion behavior. */
  as?: MotionTag;
}

/**
 * Standard "fade up + de-blur on scroll into view" entrance. Encapsulates the
 * pattern repeated across the marketing site so sections stay consistent.
 * Honors prefers-reduced-motion automatically via the surrounding
 * <MotionConfig reducedMotion="user"> (transform/blur dropped, opacity kept).
 */
export function Reveal({ delay = 0, y = 24, as = "div", children, ...props }: RevealProps) {
  const Tag = motion[as] as typeof motion.div;
  return (
    <Tag
      initial="hidden"
      whileInView="show"
      viewport={viewport.once}
      variants={{
        hidden: { opacity: 0, y, filter: "blur(4px)" },
        show: {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1], delay },
        },
      }}
      {...props}
    >
      {children}
    </Tag>
  );
}

/**
 * Parent wrapper that staggers the entrance of any nested <RevealItem> children.
 * Children should NOT set their own initial/whileInView — they inherit from here.
 */
export function RevealGroup({ as = "div", children, ...props }: RevealProps) {
  const Tag = motion[as] as typeof motion.div;
  return (
    <Tag
      initial="hidden"
      whileInView="show"
      viewport={viewport.once}
      variants={revealGroupVariants}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** Child of <RevealGroup>; reveals in sequence with the shared variant. */
export function RevealItem({ as = "div", children, ...props }: Omit<RevealProps, "delay" | "y">) {
  const Tag = motion[as] as typeof motion.div;
  return (
    <Tag variants={revealVariants} {...props}>
      {children}
    </Tag>
  );
}
