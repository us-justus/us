"use client";
import * as motion from "motion/react-client";
import Link from "next/link";

export function Shell({ title, subtitle, step, children }: { title: string; subtitle: string; step?: string; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="flex flex-col">
      {step && <p className="text-[11px] tracking-[0.18em] uppercase text-ink-faint">{step}</p>}
      <h1 className="mt-2 font-display text-[28px] sm:text-[34px] tracking-[-0.03em] leading-none">{title}</h1>
      <p className="mt-3 text-[13px] leading-6 text-ink-soft max-w-[38ch]">{subtitle}</p>
      <div className="mt-8">{children}</div>
      <Link href="/" className="mt-8 text-[11px] tracking-[0.12em] uppercase text-ink-faint hover:text-ink-soft">← back home</Link>
    </motion.div>
  );
}

export function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-2 text-[12px] text-[#a63d2f]">{msg}</p>;
}
