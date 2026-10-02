"use server";

import { createClient } from "@/lib/supabase/server";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { getLaunchState, guardLaunch } from "@/lib/auth/launch";

export type SendMessageResult =
  | { ok: true; id: string; created_at: string }
  | { ok: false; error: string };

const GENERIC_ERROR = "couldn't send — try again";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Single server mutation for sending a chat message.
 *
 * 1. authenticate user (getUser once)
 * 2. verify product + launch access
 * 3. validate matchId (UUID shape — no DB error surface)
 * 4. explicitly verify caller belongs to the match (never trust client)
 * 5-7. trim / reject whitespace-only / reject >1000 chars
 * 8. sender_id = authenticated user (client never supplies it)
 * 9. insert message, return typed result
 *
 * Block semantics are a follow-up safety task — a future block check can be
 * inserted here before the message insert.
 */
export async function sendMessageAction(
  matchId: string,
  body: string,
): Promise<SendMessageResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: GENERIC_ERROR };

  const session = await getProductSession(user);
  if (guardProductSession(session)) return { ok: false, error: GENERIC_ERROR };
  if (guardLaunch(await getLaunchState())) return { ok: false, error: GENERIC_ERROR };

  if (typeof matchId !== "string" || !UUID_RE.test(matchId)) {
    return { ok: false, error: GENERIC_ERROR };
  }

  const trimmed = (body ?? "").trim();
  if (!trimmed) return { ok: false, error: GENERIC_ERROR };
  if (trimmed.length > 1000) return { ok: false, error: GENERIC_ERROR };

  const { data: match, error: matchError } = await supabase
    .from("matches")
    .select("id")
    .eq("id", matchId)
    .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
    .maybeSingle();
  if (matchError || !match) return { ok: false, error: GENERIC_ERROR };

  // Future block-check insertion point (before insert, same mutation).
  const { data: inserted, error: insertError } = await supabase
    .from("messages")
    .insert({ match_id: matchId, sender_id: user.id, body: trimmed })
    .select("id, created_at")
    .single();
  if (insertError || !inserted) {
    if (process.env.NODE_ENV !== "production") {
      console.error(
        "[chat] send error",
        insertError?.code,
        insertError?.message,
      );
    }
    return { ok: false, error: GENERIC_ERROR };
  }

  const row = inserted as { id: string; created_at: string };
  return { ok: true, id: row.id, created_at: row.created_at };
}
