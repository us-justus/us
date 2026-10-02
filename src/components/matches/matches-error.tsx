"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Matches load failure — explicit error, never a silent "no matches".
 * Retry re-runs the server component (router.refresh) without exposing
 * database internals.
 */
export function MatchesError({ message }: { message: string }) {
  const router = useRouter();
  return (
    <div
      role="alert"
      className="mt-8 rounded-2xl border border-accent-soft bg-accent-wash px-5 py-6 text-center"
    >
      <p className="font-display text-[22px] tracking-[-0.02em] text-ink">couldn&apos;t load matches.</p>
      <p className="mx-auto mt-2 max-w-[32ch] text-[14px] leading-6 text-accent-deep">{message}</p>
      <Button variant="subtle" onClick={() => router.refresh()} className="mt-5">
        try again
      </Button>
    </div>
  );
}
