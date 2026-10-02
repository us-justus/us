"use client";

import { cn } from "@/lib/utils/cn";

/**
 * STEP 3D.1 — reusable invite share card (presentation only).
 *
 * Minimal, editorial, premium. Warm paper background, dark serif type,
 * restrained coral accent. No gradients, no glass, no shadows, no emoji.
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
        // Stable portrait aspect for messaging-app previews (3:4).
        "flex aspect-[3/4] w-full flex-col items-center justify-between",
        "border border-line bg-paper px-6 py-8 text-center",
        // Restrained rounding — editorial, not SaaS. Flat (no shadow/blur).
        "rounded-[20px]",
        className,
      )}
    >
      <div className="flex flex-col items-center">
        <p className="font-display text-[34px] leading-none tracking-[-0.04em] text-ink lowercase">
          us
        </p>
        <p className="mt-1 font-display text-[15px] tracking-[-0.01em] text-ink-soft">
          just us.
        </p>
      </div>

      <div className="flex flex-col items-center">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        <p className="mt-4 font-display text-[30px] leading-[1.15] tracking-[-0.02em] text-ink">
          join us.
        </p>
        <p className="mt-1 font-display text-[30px] leading-[1.15] tracking-[-0.02em] text-ink">
          i&apos;m{" "}
          <span className="text-accent-deep">#{spot ?? "—"}</span>.
        </p>
        <p className="mt-3 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
          secure your spot.
        </p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <span aria-hidden className="h-px w-8 bg-line-strong" />
        <p className="text-[13px] tracking-[0.06em] text-ink-soft lowercase">
          @{username}
        </p>
      </div>
    </div>
  );
}
