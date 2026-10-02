"use client";

import { useState } from "react";
import { InviteShareSheet } from "@/components/sharing/invite-share-sheet";

/**
 * STEP 3D.1 entry point — keeps the existing "invite friends" button, but
 * opens the polished share-card sheet instead of sharing a raw URL
 * directly. Username/#spot are reused from the pre-launch panel (no extra
 * auth calls); the sheet lazily fetches the stable invite URL itself.
 */
export function InviteButton({
  username,
  spot,
}: {
  username: string;
  spot: number | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-line bg-paper px-8 py-[13px] text-[12px] tracking-[0.16em] uppercase font-medium text-ink transition-colors hover:bg-paper-2 hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        invite friends
      </button>
      <InviteShareSheet
        username={username}
        spot={spot}
        open={open}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
