import type { SupabaseClient } from "@supabase/supabase-js";

const MATCHES_LIMIT = 100;

/**
 * Chat read-state queries (server-side only).
 *
 * Chat and the notification bell are intentionally SEPARATE systems: a
 * message never creates a notification row, and no notification record is
 * ever the source of truth for chat unread state. Unread chat state is a
 * per-user/per-match cursor in public.chat_read_state; Supabase Realtime is
 * delivery/activity only, never persistent state.
 *
 * Derivation (single rule, used by inbox + header alike):
 *   unread = a latest message exists
 *        AND the latest message was sent by the OTHER user
 *        AND (no cursor row OR cursor.last_seen_message_id <> latest.id)
 * Own-only and never-messaged conversations are never unread.
 *
 * Read semantics (MVP): opening /chat/[matchId] with a successful load
 * advances the viewer's cursor to the match's latest message id via
 * mark_chat_seen(). Merely appearing in the /chat inbox never marks read.
 * No read receipts, no per-message seen, no presence — opening is enough.
 *
 * Pre-migration degradation (same posture as the notifications badge):
 * when the table/RPC does not exist yet, reads degrade to "nothing unread"
 * rather than erroring.
 */

export type SeenMap = {
  /** match_id -> last_seen_message_id (null when the cursor holds no message). */
  seenByMatch: Map<string, string | null>;
  /** False when the read-state lookup itself failed (e.g. pre-migration). */
  ok: boolean;
};

/** Batched cursor lookup for the inbox — one query, never per-match (no N+1). */
export async function getSeenMap(
  supabase: SupabaseClient,
  userId: string,
  matchIds: string[],
): Promise<SeenMap> {
  if (!matchIds.length) return { seenByMatch: new Map(), ok: true };
  const { data, error } = await supabase
    .from("chat_read_state")
    .select("match_id, last_seen_message_id")
    .eq("user_id", userId)
    .in("match_id", matchIds);
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      if (String(process.env.NODE_ENV) !== "production") console.error("[chat] read-state error", error.code);
    }
    return { seenByMatch: new Map(), ok: false };
  }
  const seenByMatch = new Map<string, string | null>();
  for (const row of (data ?? []) as { match_id: string; last_seen_message_id: string | null }[]) {
    seenByMatch.set(row.match_id, row.last_seen_message_id);
  }
  return { seenByMatch, ok: true };
}

/**
 * Global chat-activity flag for the header dot (💬 • vs 💬).
 * One RPC round-trip; the server derives it from match membership + latest
 * messages + cursors. Never derived from notifications — unreadCount stays
 * exclusively notification state.
 */
export async function hasUnreadChat(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_unread_chat");
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      if (String(process.env.NODE_ENV) !== "production") console.error("[chat] unread flag error", error.code);
    }
    return false;
  }
  return data === true;
}

/**
 * Match IDs the caller belongs to (bounded). Feeds the header's realtime
 * activity listener so it subscribes with one filtered binding per known
 * match — the same filtered pattern as the conversation/inbox subscriptions.
 * Never a global unfiltered subscription; match IDs only, never user IDs.
 */
export async function getChatMatchIds(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("matches")
    .select("id")
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .limit(MATCHES_LIMIT);
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      if (String(process.env.NODE_ENV) !== "production") console.error("[chat] match ids error", error.code);
    }
    return [];
  }
  return ((data ?? []) as { id: string }[]).map((m) => m.id);
}

/**
 * Advance the caller's cursor for one match to its latest message.
 * Server-side wrapper over mark_chat_seen() (membership verified in the
 * RPC; RLS stays the database-level enforcement). Best-effort: a mark
 * failure must never fail the page render or the send.
 */
export async function markConversationSeen(
  supabase: SupabaseClient,
  matchId: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabase.rpc("mark_chat_seen", { p_match_id: matchId });
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      if (String(process.env.NODE_ENV) !== "production") console.error("[chat] mark seen error", error.code);
    }
    return { ok: false };
  }
  return { ok: true };
}
