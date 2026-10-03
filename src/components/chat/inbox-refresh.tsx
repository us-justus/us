"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Inbox realtime refresh — lightweight only.
 *
 * Subscribes to message INSERTs and re-renders the server inbox
 * (router.refresh) when one lands in any of the user's matches. The server
 * re-query re-sorts (latest first) and re-renders previews, so rows move to
 * the top and never duplicate — no client message state, no redesign of the
 * conversation's realtime architecture, no polling.
 *
 * Each match gets its own server-side `match_id=eq.<id>` binding — the same
 * filtered pattern as the conversation subscription (`chat:${matchId}`),
 * which is the proven delivery path. The client-side `allowed` set stays as
 * a second guard so a stray payload can never refresh the wrong inbox.
 * Bindings are bounded by the server inbox match limit (100). The payload
 * is only a tripwire (match_id checked, content never read): it also emits
 * `us:chat-activity` so the header re-resolves its 💬 dot live.
 */
export function InboxRefresh({ matchIds }: { matchIds: string[] }) {
  const router = useRouter();
  const key = matchIds.join(",");

  useEffect(() => {
    const ids = key.split(",").filter(Boolean);
    if (!ids.length) return;
    const allowed = new Set(ids);
    const supabase = createClient();
    const channel = supabase.channel("chat:inbox");
    for (const id of ids) {
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${id}` },
        (payload) => {
          const matchId = (payload.new as { match_id?: string } | null)?.match_id;
          if (typeof matchId === "string" && allowed.has(matchId)) {
            // The server inbox re-query re-sorts and flags the unread row;
            // the header re-resolves its dot from the same server truth.
            window.dispatchEvent(new CustomEvent("us:chat-activity"));
            router.refresh();
          }
        },
      );
    }
    channel.subscribe();
    // Bounded recovery for mobile background socket drops — mirrors the
    // conversation island's visibility refetch. No polling: one refresh
    // only when returning to the visible inbox.
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [router, key]);

  return null;
}
