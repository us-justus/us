"use server";

import { createClient } from "@/lib/supabase/server";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { swipeAction } from "@/lib/discover/actions";

export type LikeBackResult =
  | { ok: true; matched: boolean; matchId: string | null; alreadyResolved: boolean }
  | { ok: false; error: string };

export type IgnoreResult = { ok: true; alreadyResolved: boolean } | { ok: false; error: string };

type OwnedNotification = {
  id: string;
  type: string;
  actor_id: string | null;
  reference_id: string | null;
  read_at: string | null;
  resolved_at: string | null;
  deleted_at: string | null;
};

async function loadOwnedNotification(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  notificationId: string,
): Promise<{ row: OwnedNotification | null; missingColumn: boolean }> {
  const full = await supabase
    .from("notifications")
    .select("id, type, actor_id, reference_id, read_at, resolved_at, deleted_at")
    .eq("id", notificationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!full.error) return { row: (full.data as OwnedNotification | null) ?? null, missingColumn: false };
  if (/resolved_at/i.test(full.error.message ?? "")) {
    const legacy = await supabase
      .from("notifications")
      .select("id, type, actor_id, reference_id, read_at, deleted_at")
      .eq("id", notificationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (legacy.error) return { row: null, missingColumn: true };
    const row = legacy.data as (Omit<OwnedNotification, "resolved_at"> | null);
    return { row: row ? { ...row, resolved_at: null } : null, missingColumn: true };
  }
  return { row: null, missingColumn: false };
}

async function findMatchId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  a: string,
  b: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("matches")
    .select("id")
    .or(`and(user_a_id.eq.${a},user_b_id.eq.${b}),and(user_a_id.eq.${b},user_b_id.eq.${a})`)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Like back from a LIKE notification.
 *
 * Delegates to the canonical swipeAction(actorId, "like") — no parallel
 * like implementation, no direct matches-table writes. Idempotent:
 * swipeAction absorbs duplicate likes (23505), the match trigger absorbs
 * duplicate matches, create_notification absorbs duplicate MATCH rows, and
 * resolving the LIKE notification is a plain idempotent UPDATE.
 */
export async function likeBackNotificationAction(notificationId: string): Promise<LikeBackResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const session = await getProductSession(user);
  if (guardProductSession(session)) return { ok: false, error: "Finish onboarding to respond." };

  const { row } = await loadOwnedNotification(supabase, user.id, notificationId);
  if (!row || row.deleted_at) return { ok: false, error: "That notification is gone." };
  if (row.type !== "LIKE") return { ok: false, error: "Only likes can be liked back." };
  if (!row.actor_id) return { ok: false, error: "That notification has no one to like back." };

  // Already handled (other tab, double submit, stale page): return the
  // current match state so the UI settles into MATCH gracefully.
  if (row.resolved_at) {
    const matchId = await findMatchId(supabase, user.id, row.actor_id);
    return { ok: true, matched: !!matchId, matchId, alreadyResolved: true };
  }

  // The actor/recipient relationship must come from server-side data —
  // never from client-supplied user IDs. When the referenced like row still
  // exists it must belong to this actor → recipient pair.
  if (row.reference_id) {
    const { data: like } = await supabase
      .from("likes")
      .select("from_user_id, to_user_id")
      .eq("id", row.reference_id)
      .maybeSingle();
    const l = like as { from_user_id: string; to_user_id: string } | null;
    if (l && (l.from_user_id !== row.actor_id || l.to_user_id !== user.id)) {
      return { ok: false, error: "That notification no longer matches." };
    }
  }

  // Canonical like — identical to liking from Discover.
  const swipe = await swipeAction(row.actor_id, "like");
  if (swipe.error) return { ok: false, error: swipe.error };

  // Resolve so competing Like Back / Ignore controls disappear. History
  // stays (no physical delete). Mark read too so the badge clears; the new
  // MATCH notification carries its own unread state.
  const now = new Date().toISOString();
  await supabase
    .from("notifications")
    .update({ resolved_at: now, read_at: row.read_at ?? now })
    .eq("id", row.id)
    .eq("user_id", user.id)
    .is("deleted_at", null);

  const matchId = await findMatchId(supabase, user.id, row.actor_id);
  return { ok: true, matched: matchId ? true : swipe.matched, matchId, alreadyResolved: false };
}

/**
 * Ignore a LIKE notification ("I don't want to act on this").
 *
 * Resolution only (resolved_at + read_at). Never creates a pass, never
 * unlikes, never blocks, never touches recommendation state — the
 * underlying LIKE row stays intact and Discover ordering is unchanged.
 */
export async function ignoreNotificationAction(notificationId: string): Promise<IgnoreResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const session = await getProductSession(user);
  if (guardProductSession(session)) return { ok: false, error: "Finish onboarding to respond." };

  const { row } = await loadOwnedNotification(supabase, user.id, notificationId);
  if (!row || row.deleted_at) return { ok: false, error: "That notification is gone." };
  if (row.type !== "LIKE") return { ok: false, error: "Only likes can be ignored." };
  if (row.resolved_at) return { ok: true, alreadyResolved: true };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("notifications")
    .update({ resolved_at: now, read_at: row.read_at ?? now })
    .eq("id", row.id)
    .eq("user_id", user.id)
    .is("deleted_at", null);
  if (error) {
    if (/resolved_at/i.test(error.message ?? "")) {
      // Pre-migration fallback: no resolution column yet — fall back to
      // marking read so the row at least leaves the active set.
      await supabase
        .from("notifications")
        .update({ read_at: row.read_at ?? now })
        .eq("id", row.id)
        .eq("user_id", user.id)
        .is("deleted_at", null);
      return { ok: true, alreadyResolved: false };
    }
    return { ok: false, error: "Couldn't ignore that — try again." };
  }
  return { ok: true, alreadyResolved: false };
}
