"use client";

import { useState } from "react";
import { InviteShareSheet } from "@/components/sharing/invite-share-sheet";

/**
 * STEP 3D.1 entry point — keeps the existing share sheet, but
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
    <div>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-4 text-[14px] text-ink-soft transition-colors hover:bg-paper-2 hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span aria-hidden>↗</span> share your spot
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
