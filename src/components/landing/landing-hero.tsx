"use client";

import Link from "next/link";
import * as motion from "motion/react-client";
import { useReducedMotion } from "motion/react";
import { Wordmark } from "@/components/brand/wordmark";

export function LandingHero() {
  const shouldReduceMotion = useReducedMotion();
  const reveal = (y: number, delay: number) => ({
    initial: { opacity: 0, y: shouldReduceMotion ? 0 : y },
    animate: { opacity: 1, y: 0 },
    transition: { duration: shouldReduceMotion ? 0 : 0.6, delay: shouldReduceMotion ? 0 : delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <div className="flex flex-1 flex-col">
      <section className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center sm:py-20">
        <motion.div
          {...reveal(10, 0)}
        >
          <Wordmark size="hero" />
        </motion.div>

        <motion.p
          {...reveal(8, 0.18)}
          className="mt-3 font-display text-[24px] sm:text-[28px] tracking-[-0.02em] text-ink-soft"
        >
          just us.
        </motion.p>

        <motion.p
          {...reveal(0, 0.32)}
          className="mt-6 max-w-[32ch] text-[15px] sm:text-[16px] leading-7 sm:leading-8 text-ink-faint"
        >
          a private space for your campus.
          <br />
          verified students only — no noise, just us.
        </motion.p>

        <motion.div
          {...reveal(8, 0.46)}
          className="mt-8 flex flex-col items-center gap-4"
        >
          <Link
            href="/onboarding"
            className="group inline-flex min-h-[44px] items-center gap-3 rounded-full bg-ink px-8 py-[14px] text-[12.5px] tracking-[0.16em] uppercase font-medium text-paper transition-all hover:bg-black hover:gap-4 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
            className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-line bg-paper px-8 py-[13px] text-[12px] tracking-[0.16em] uppercase font-medium text-ink transition-colors hover:bg-paper-2 hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            log in
          </Link>
        </motion.div>
      </section>
    </div>
  );
}
