"use client"

import { useState } from "react"
import Link from "next/link"
import { ThemeToggle } from "@/components/ui/theme-toggle"

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      <nav
        className="fixed top-5 left-1/2 -translate-x-1/2 w-[95%] max-w-[1100px] h-[64px] z-50 flex items-center rounded-2xl"
        style={{
          backgroundColor: "var(--nav-bg)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid var(--nav-border)",
          boxShadow: "var(--shadow-md)",
        }}
      >
        <div className="flex justify-between items-center w-full px-6">
          <Link
            href="/"
            className="text-xl font-bold text-[var(--text-primary)]"
          >
            SovereignML
          </Link>

          <div className="hidden md:flex gap-8">
            {[
              { href: "/#features", label: "Features" },
              { href: "/#agents", label: "Agents" },
              { href: "/#pricing", label: "Pricing" },
              { href: "/docs", label: "Docs" },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm font-medium transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link href="/login" className="btn-clean-secondary !py-2 !px-5 !text-sm !rounded-full">
              Log In
            </Link>
            <a
              href="https://tidycal.com/sovereignml/demo"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-gradient !py-2 !px-5 !text-sm"
            >
              Book Demo
            </a>
            <div className="w-px h-6 bg-[var(--border-color)] mx-1" />
            <ThemeToggle className="w-8 h-8" />
          </div>

          <button
            className="md:hidden flex flex-col justify-between w-[26px] h-[18px] bg-transparent border-none cursor-pointer"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <span
              className={`w-full h-[2px] rounded-full bg-[var(--text-primary)] transition-all duration-300 ${
                mobileOpen ? "translate-y-[8px] rotate-45" : ""
              }`}
            />
            <span
              className={`w-full h-[2px] rounded-full bg-[var(--text-primary)] transition-all duration-300 ${
                mobileOpen ? "opacity-0" : ""
              }`}
            />
            <span
              className={`w-full h-[2px] rounded-full bg-[var(--text-primary)] transition-all duration-300 ${
                mobileOpen ? "-translate-y-[8px] -rotate-45" : ""
              }`}
            />
          </button>
        </div>
      </nav>

      {mobileOpen && (
        <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-6 bg-[var(--bg-color)]">
          <button
            className="absolute top-8 right-8 text-[var(--text-primary)]"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
          {[
            { href: "/#features", label: "Features" },
            { href: "/#agents", label: "Agents" },
            { href: "/#pricing", label: "Pricing" },
            { href: "/docs", label: "Docs" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[var(--text-primary)] text-xl font-medium hover:text-[var(--accent-color)] transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <hr className="border-[var(--border-color)] w-32" />
          <a
            href="https://tidycal.com/sovereignml/demo"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-clean-secondary"
            onClick={() => setMobileOpen(false)}
          >
            Book Demo
          </a>
          <Link href="/login" className="btn-gradient" onClick={() => setMobileOpen(false)}>
            Log In
          </Link>
        </div>
      )}

    </>
  )
}
