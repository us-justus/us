"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";

export function MatchOverlay({
  onKeepDiscovering,
}: {
  onKeepDiscovering: () => void;
}) {
  // Honor the OS reduced-motion setting: motion/react animations are JS-driven
  // and ignore the CSS-only reduced-motion reset in globals.css.
  const reduceMotion = useReducedMotion();
  const d = (v: number) => (reduceMotion ? 0 : v);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: d(0.25) }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-accent-wash px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-center"
    >
      <motion.p
        initial={{ opacity: 0, y: d(8) }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: d(0.15), duration: d(0.4) }}
        className="font-display text-[42px] leading-none tracking-[-0.04em] text-ink"
      >
        it&apos;s a match<span aria-hidden className="text-accent">.</span>
      </motion.p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: d(0.35), duration: d(0.4) }}
        className="mt-3 text-[14px] tracking-wide text-ink-soft"
      >
        you both liked each other.
      </motion.p>
      <motion.div
        initial={{ opacity: 0, y: d(6) }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: d(0.55), duration: d(0.4) }}
        className="mt-10 flex flex-col items-center gap-3"
      >
        <Link
          href="/matches"
          className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-8 py-3 text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          say hi
        </Link>
        <button
          onClick={onKeepDiscovering}
          className="min-h-[44px] px-4 text-[13px] tracking-wide text-ink-soft transition-colors hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-full"
        >
          keep discovering
        </button>
      </motion.div>
    </motion.div>
  );
}
