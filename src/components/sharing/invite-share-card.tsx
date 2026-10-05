"use client";

import { cn } from "@/lib/utils/cn";

/**
 * Minimal invite share card (presentation only).
 *
 * Small invitation artifact — not the sheet. Mobile-first compact:
 * ~62% of the sheet width (capped at 180px) in a 4:5 portrait so the
 * whole sheet fits the visible viewport without scrolling; the `sm:`
 * overrides restore the roomier 3:4 desktop artifact unchanged.
 * Content: us / just us. / i'm #spot. / @username.
 * No marketing copy, no urgency, no countdowns, no social proof.
 *
 * Data: username + permanent #spot only. Never renders USN, email, auth
 * IDs, or the invite token (attribution stays in the URL, not the card).
 */
export function InviteShareCard({
  username,
  spot,
  className,
}: {
  username: string;
  spot: number | null;
  className?: string;
}) {
  return (
    <div
      aria-hidden={false}
      className={cn(
        // Small centered artifact with explicit caps. Base = compact
        // mobile 4:5 (height follows width, so a narrower card is a
        // shorter card); sm: restores the roomier 3:4 desktop artifact.
        "mx-auto flex aspect-[4/5] w-[62%] max-w-[180px] flex-col items-center justify-between",
        "border border-line bg-paper px-5 py-4 text-center",
        // Restrained rounding — editorial, not SaaS. Flat (no shadow/blur).
        "rounded-[20px]",
        "sm:aspect-[3/4] sm:w-[72%] sm:max-w-[240px] sm:py-6",
        className,
      )}
    >
      <div className="flex flex-col items-center">
        <p className="font-display text-[26px] leading-none tracking-[-0.04em] text-ink lowercase sm:text-[28px]">
          us
        </p>
        <p className="mt-0.5 font-display text-[13px] tracking-[-0.01em] text-ink-soft sm:mt-1 sm:text-[14px]">
          just us.
        </p>
      </div>

      <div className="flex flex-col items-center">
        <p className="font-display text-[24px] leading-[1.15] tracking-[-0.02em] text-ink sm:text-[26px]">
          i&apos;m{" "}
          <span className="text-accent-deep">#{spot ?? "—"}</span>.
        </p>
      </div>

      <div className="flex flex-col items-center gap-1.5 sm:gap-2">
        <span aria-hidden className="h-px w-8 bg-line-strong" />
        <p className="text-[12px] tracking-[0.06em] text-ink-soft lowercase">
          @{username}
        </p>
      </div>
    </div>
  );
}
