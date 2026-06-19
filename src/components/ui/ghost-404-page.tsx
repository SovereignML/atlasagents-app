'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ghost } from 'lucide-react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';

import { Button } from '@/components/ui/button';

const containerVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 30
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.7,
      ease: [0.43, 0.13, 0.23, 0.96],
      delayChildren: 0.1,
      staggerChildren: 0.1
    }
  }
};

const itemVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 20
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.43, 0.13, 0.23, 0.96]
    }
  }
};

const numberVariants: Variants = {
  hidden: (direction: number) => ({
    opacity: 0,
    x: direction * 40,
    y: 15,
    rotate: direction * 5
  }),
  visible: {
    opacity: 0.7,
    x: 0,
    y: 0,
    rotate: 0,
    transition: {
      duration: 0.8,
      ease: [0.43, 0.13, 0.23, 0.96]
    }
  }
};

const ghostVariants: Variants = {
  hidden: {
    scale: 0.8,
    opacity: 0,
    y: 15,
    rotate: -5
  },
  visible: {
    scale: 1,
    opacity: 1,
    y: 0,
    rotate: 0,
    transition: {
      duration: 0.6,
      ease: [0.43, 0.13, 0.23, 0.96]
    }
  },
  hover: {
    scale: 1.1,
    y: -10,
    rotate: [0, -5, 5, -5, 0],
    transition: {
      duration: 0.8,
      ease: "easeInOut",
      rotate: {
        duration: 2,
        ease: "linear",
        repeat: Infinity,
        repeatType: "reverse"
      }
    }
  },
  floating: {
    y: [-5, 5],
    transition: {
      y: {
        duration: 2,
        ease: "easeInOut",
        repeat: Infinity,
        repeatType: "reverse"
      }
    }
  }
};

export function NotFound({ isLoggedIn }: { isLoggedIn: boolean }) {
  const router = useRouter();

  const primaryHref = isLoggedIn ? "/dashboard" : "/";
  const primaryLabel = isLoggedIn ? "Back to dashboard" : "Back home";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <AnimatePresence mode="wait">
        <motion.div
          className="text-center"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          <div className="flex items-center justify-center gap-4 md:gap-6 mb-8 md:mb-12">
            <motion.span
              className="text-[80px] md:text-[120px] font-bold text-foreground opacity-70 select-none"
              variants={numberVariants}
              custom={-1}
            >
              4
            </motion.span>
            <motion.div
              variants={ghostVariants}
              whileHover="hover"
              animate={["visible", "floating"]}
            >
              <Ghost
                aria-hidden
                className="w-20 h-20 md:w-28 md:h-28 text-foreground/70 select-none"
                strokeWidth={1.5}
              />
            </motion.div>
            <motion.span
              className="text-[80px] md:text-[120px] font-bold text-foreground opacity-70 select-none"
              variants={numberVariants}
              custom={1}
            >
              4
            </motion.span>
          </div>

          <motion.h1
            className="text-3xl md:text-5xl font-bold text-foreground mb-4 md:mb-6 opacity-90 select-none"
            variants={itemVariants}
          >
            Page not found
          </motion.h1>

          <motion.p
            className="text-lg md:text-xl text-muted-foreground mb-8 md:mb-12 select-none"
            variants={itemVariants}
          >
            We couldn&apos;t find the page you&apos;re looking for. It may have moved or no longer exists.
          </motion.p>

          <motion.div
            className="flex flex-col sm:flex-row items-center justify-center gap-3"
            variants={itemVariants}
          >
            <Button
              size="pill"
              render={<Link href={primaryHref} />}
            >
              {primaryLabel}
            </Button>
            <Button
              variant="outline"
              size="pill"
              onClick={() => router.back()}
            >
              Go back
            </Button>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
