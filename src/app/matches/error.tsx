"use client";

import { Button } from "@/components/ui/button";

/**
 * /matches route boundary — catches unexpected render failures (never a
 * silent empty list). Retry re-runs the segment via reset().
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[560px] px-6 sm:px-8 py-10 sm:py-14">
      <p className="flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        matches
      </p>
      <div
        role="alert"
        className="mt-6 rounded-2xl border border-accent-soft bg-accent-wash px-5 py-6 text-center"
      >
        <p className="font-display text-[22px] tracking-[-0.02em] text-ink">something went wrong.</p>
        <p className="mx-auto mt-2 max-w-[32ch] text-[14px] leading-6 text-accent-deep">
          your matches are safe — this page just didn&apos;t load. please try again.
        </p>
        <Button variant="subtle" onClick={() => reset()} className="mt-5">
          try again
        </Button>
      </div>
    </div>
  );
}
