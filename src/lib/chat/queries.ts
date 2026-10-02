import type { SupabaseClient } from "@supabase/supabase-js";

export type ChatMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

const HISTORY_LIMIT = 50;

/**
 * Server-side bounded message history for one match.
 *
 * WHERE match_id = current match ORDER BY created_at DESC LIMIT 50, then
 * reversed for chronological rendering. The composite index
 * (match_id, created_at) supports this query. Structured for future keyset
 * pagination (created_at cursor) without rewriting the data model.
 */
export async function getChatHistory(
  supabase: SupabaseClient,
  matchId: string,
): Promise<{ messages: ChatMessage[]; error: string | null }> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[chat] history error", error.code, error.message);
    }
    return { messages: [], error: "Couldn't load messages. Please try again." };
  }

  const rows = (data ?? []) as ChatMessage[];
  return { messages: rows.reverse(), error: null };
}
