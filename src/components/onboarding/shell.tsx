"use client";
import * as motion from "motion/react-client";
import { useReducedMotion } from "motion/react";
import Link from "next/link";

export function Shell({ title, subtitle, step, children }: { title: string; subtitle: string; step?: string; children: React.ReactNode }) {
  // motion/react animations are JS-driven and ignore the CSS-only
  // reduced-motion reset — honor the OS setting here like MatchOverlay does.
  const reduceMotion = useReducedMotion();
  return (
    <motion.div initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] }} className="flex flex-col">
      {step && (
        <p className="flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          {step}
        </p>
      )}
      <h1 className="mt-2 font-display text-[28px] sm:text-[34px] tracking-[-0.03em] leading-none text-ink">{title}</h1>
      <p className="mt-3 text-[13px] leading-6 text-ink-soft max-w-[38ch]">{subtitle}</p>
      <div className="mt-8">{children}</div>
      <Link href="/" className="mt-8 inline-flex min-h-[44px] items-center text-[11px] tracking-[0.12em] uppercase text-ink-faint hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-full">← back home</Link>
    </motion.div>
  );
}

export function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <div className="mt-2 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
      <p className="text-[12px] leading-5 text-accent-deep">{msg}</p>
    </div>
  );
}
