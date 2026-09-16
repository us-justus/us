"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Wordmark } from "@/components/brand/wordmark";
import { cn } from "@/lib/utils/cn";

const links = [
  { href: "/discover", label: "discover" },
  { href: "/matches", label: "matches" },
  { href: "/chat", label: "chat" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isLanding = pathname === "/";

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b",
        isLanding
          ? "bg-paper/80 backdrop-blur-[8px] border-transparent"
          : "bg-paper/80 backdrop-blur-[8px] border-line",
      )}
    >
      <div className="mx-auto max-w-[1080px] px-6 sm:px-8 flex h-[56px] items-center justify-between">
        <Link href="/" className="flex items-center" aria-label="us home">
          <Wordmark size="sm" />
        </Link>

        <nav className="hidden sm:flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "px-3 py-1.5 text-[13px] tracking-[0.08em] lowercase rounded-full transition-colors",
                pathname === l.href
                  ? "text-ink bg-paper-2"
                  : "text-ink-soft hover:text-ink",
              )}
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/onboarding"
            className="ml-2 inline-flex items-center rounded-full bg-ink px-5 py-2 text-[12px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors"
          >
            enter
          </Link>
        </nav>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="toggle menu"
          className="sm:hidden inline-flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink"
        >
          <span className="relative block h-3 w-3.5">
            <span
              className={cn(
                "absolute left-0 top-0 h-px w-full bg-ink transition-transform",
                open && "translate-y-[5px] rotate-45",
              )}
            />
            <span
              className={cn(
                "absolute left-0 top-[5px] h-px w-full bg-ink transition-opacity",
                open && "opacity-0",
              )}
            />
            <span
              className={cn(
                "absolute left-0 top-[10px] h-px w-full bg-ink transition-transform",
                open && "-translate-y-[5px] -rotate-45",
              )}
            />
          </span>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="sm:hidden border-t border-line bg-paper"
          >
            <nav className="px-6 py-5 flex flex-col gap-1">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "py-2.5 text-[14px] tracking-[0.08em] lowercase border-b border-line last:border-0",
                    pathname === l.href ? "text-ink" : "text-ink-soft",
                  )}
                >
                  {l.label}
                </Link>
              ))}
              <Link
                href="/onboarding"
                onClick={() => setOpen(false)}
                className="mt-3 inline-flex justify-center rounded-full bg-ink px-6 py-3 text-[13px] tracking-[0.14em] uppercase font-medium text-paper"
              >
                enter the campus
              </Link>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
