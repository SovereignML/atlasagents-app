"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { motion, AnimatePresence, useScroll, useMotionValueEvent } from "framer-motion"
import { BRANDING } from "@/configs/branding"
import { easing, staggerDelay } from "@/lib/motion"

const NAV_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#agents", label: "Agents" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
]

export default function Navbar({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  // The home page ("/") renders this client navbar without the server-resolved
  // `isAuthenticated` prop (only (marketing)/layout passes it), so the bar would
  // always read "Log In" on reload. Fall back to the client session so the
  // Dashboard link renders once auth rehydrates. The prop is kept as an SSR
  // hint to avoid a flash where it's available.
  const { status } = useSession()
  const authed = isAuthenticated || status === "authenticated"

  const accountHref = authed ? "/dashboard" : "/login"
  const accountLabel = authed ? "Dashboard" : "Log In"

  // Solidify the bar once the user scrolls past the hero's top edge.
  const { scrollY } = useScroll()
  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 24))

  return (
    <>
      <nav
        className="fixed top-5 left-1/2 -translate-x-1/2 w-[95%] max-w-[1100px] h-[64px] z-50 flex items-center rounded-2xl"
        style={{
          backgroundColor: scrolled ? "rgba(0, 10, 31, 0.82)" : "rgba(0, 10, 31, 0.6)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: scrolled
            ? "0 10px 34px rgba(0, 0, 0, 0.45)"
            : "0 4px 20px rgba(0, 0, 0, 0.3)",
          transition: "background-color 0.3s ease, box-shadow 0.3s ease",
        }}
      >
        <div className="flex justify-between items-center w-full px-6">
          <Link href="/" className="flex items-center gap-2.5 text-xl font-bold text-white">
            <Image
              src="/assets/icons/SovereignML-logo-white.svg"
              alt=""
              width={28}
              height={28}
              className="shrink-0"
              priority
            />
            {BRANDING.name}
          </Link>

          <div className="hidden md:flex gap-8">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="relative group text-white/60 hover:text-white text-sm font-medium transition-colors"
              >
                {link.label}
                <span className="absolute left-0 -bottom-1 h-px w-full bg-white origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100" />
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link href={accountHref} className="text-white/70 hover:text-white text-sm font-medium transition-colors">
              {accountLabel}
            </Link>
            <a
              href={BRANDING.demoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-gradient !py-2 !px-5 !text-sm"
            >
              Book Demo
            </a>
          </div>

          <button
            className="md:hidden flex flex-col justify-between w-[26px] h-[18px] bg-transparent border-none cursor-pointer"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            <span
              className={`w-full h-[2px] rounded-full bg-white transition-all duration-300 ${
                mobileOpen ? "translate-y-[8px] rotate-45" : ""
              }`}
            />
            <span
              className={`w-full h-[2px] rounded-full bg-white transition-all duration-300 ${
                mobileOpen ? "opacity-0" : ""
              }`}
            />
            <span
              className={`w-full h-[2px] rounded-full bg-white transition-all duration-300 ${
                mobileOpen ? "-translate-y-[8px] -rotate-45" : ""
              }`}
            />
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: easing.outExpo }}
            className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-6 bg-background-plain"
          >
            <button
              className="absolute top-8 right-8 text-text-loud"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>

            {/* Stagger the menu items in after the overlay fades. */}
            <motion.div
              className="flex flex-col items-center gap-6"
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: staggerDelay.fast, delayChildren: 0.1 } } }}
            >
              {NAV_LINKS.map((link) => (
                <motion.div
                  key={link.href}
                  variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
                >
                  <Link
                    href={link.href}
                    className="text-text-loud text-xl font-medium hover:text-accent-blue-rest transition-colors"
                    onClick={() => setMobileOpen(false)}
                  >
                    {link.label}
                  </Link>
                </motion.div>
              ))}
              <motion.hr
                className="border-border-muted w-32"
                variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}
              />
              <motion.a
                href={BRANDING.demoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-clean-secondary"
                onClick={() => setMobileOpen(false)}
                variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
              >
                Book Demo
              </motion.a>
              <motion.div variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}>
                <Link href={accountHref} className="btn-antimetal" onClick={() => setMobileOpen(false)}>
                  {accountLabel}
                </Link>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
