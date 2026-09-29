"use client";

import Link from "next/link";
import * as motion from "motion/react-client";
import { Wordmark } from "@/components/brand/wordmark";

export function LandingHero() {
  return (
    <div className="flex flex-1 flex-col">
      <section className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <Wordmark size="hero" />
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="mt-3 font-display text-[18px] sm:text-[20px] tracking-[-0.02em] text-ink-soft"
        >
          just us.
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.32 }}
          className="mt-8 max-w-[28ch] text-[13px] sm:text-[14px] leading-6 text-ink-faint"
        >
          a private space for your campus.
          <br />
          verified students only — no noise, just us.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.46, ease: [0.22, 1, 0.36, 1] }}
          className="mt-10 flex flex-col items-center gap-4"
        >
          <Link
            href="/onboarding"
            className="group inline-flex items-center gap-3 rounded-full bg-ink px-8 py-[14px] text-[12.5px] tracking-[0.16em] uppercase font-medium text-paper transition-all hover:bg-black hover:gap-4 active:scale-[0.98]"
          >
            enter the campus
            <span
              aria-hidden
              className="text-[14px] leading-none transition-transform group-hover:translate-x-0.5"
            >
              →
            </span>
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-full border border-line bg-paper px-8 py-[13px] text-[12px] tracking-[0.16em] uppercase font-medium text-ink hover:bg-paper-2 transition-colors"
          >
            log in
          </Link>
          <span className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">
            campus-only · verified · private
          </span>
          <span className="text-[11px] leading-4 tracking-[0.08em] text-ink-faint">
            new here? enter · have an account? log in
          </span>
        </motion.div>
      </section>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.7 }}
        className="border-t border-line"
      >
        <div className="mx-auto flex max-w-[1080px] flex-col items-center justify-between gap-3 px-6 py-6 sm:flex-row sm:px-8 text-[11px] tracking-[0.12em] uppercase text-ink-faint">
          <span>est. 2026 — built for your campus</span>
          <span className="flex items-center gap-2">
            <span className="h-px w-6 bg-line-strong hidden sm:block" />
            private by design
          </span>
        </div>
      </motion.div>
    </div>
  );
}
