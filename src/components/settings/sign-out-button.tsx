"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Permanent users only. Anonymous users are never shown a sign-out action
 * (signing out would orphan the anonymous account).
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-line bg-paper px-8 py-[14px] text-[12px] tracking-[0.14em] uppercase font-medium text-ink-soft transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {busy ? "signing out…" : "sign out"}
    </button>
  );
}
