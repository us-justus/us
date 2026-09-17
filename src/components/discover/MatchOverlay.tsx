"use client";

import { motion } from "motion/react";
import Link from "next/link";

export function MatchOverlay({
  onKeepDiscovering,
}: {
  onKeepDiscovering: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-paper px-6 text-center"
    >
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
        className="font-display text-[42px] leading-none tracking-[-0.04em] text-ink"
      >
        it&apos;s a match.
      </motion.p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35, duration: 0.4 }}
        className="mt-3 text-[14px] tracking-wide text-ink-soft"
      >
        you both liked each other.
      </motion.p>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, duration: 0.4 }}
        className="mt-10 flex flex-col items-center gap-3"
      >
        <Link
          href="/matches"
          className="inline-flex rounded-full bg-ink px-8 py-3 text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors"
        >
          say hi
        </Link>
        <button
          onClick={onKeepDiscovering}
          className="text-[13px] tracking-wide text-ink-soft hover:text-ink transition-colors"
        >
          keep discovering
        </button>
      </motion.div>
    </motion.div>
  );
}
