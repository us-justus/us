"use server";

import { createClient } from "@/lib/supabase/server";
import { getLaunchState } from "@/lib/auth/launch";

export async function swipeAction(toUserId: string, direction: "like" | "pass"): Promise<{ matched: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { matched: false, error: "Not authenticated" };
  if (user.id === toUserId) return { matched: false, error: "Invalid target" };
  // PRE_LAUNCH lock: likes/passes are launch-only. Server state decides —
  // never the browser clock.
  const launch = await getLaunchState();
  if (!launch.launched) return { matched: false, error: "Discover hasn't launched yet." };

  if (direction === "like") {
    // Insert returning the id (needed as the LIKE notification reference).
    // A 23505 retry reuses the existing like row — same id, idempotent.
    let likeId: string | null = null;
    const inserted = await supabase.from("likes").insert({ from_user_id: user.id, to_user_id: toUserId }).select("id").maybeSingle();
    if (inserted.error) {
      if (inserted.error.code !== "23505" && !inserted.error.message.includes("duplicate"))
        return { matched: false, error: inserted.error.message };
      const existing = await supabase
        .from("likes")
        .select("id")
        .eq("from_user_id", user.id)
        .eq("to_user_id", toUserId)
        .maybeSingle();
      likeId = (existing.data as { id: string } | null)?.id ?? null;
    } else {
      likeId = (inserted.data as { id: string } | null)?.id ?? null;
    }
    // Single match lookup: the OR covers both orderings, so no second
    // fallback query is needed.
    const { data: match } = await supabase
      .from("matches")
      .select("id")
      .or(`and(user_a_id.eq.${user.id},user_b_id.eq.${toUserId}),and(user_a_id.eq.${toUserId},user_b_id.eq.${user.id})`)
      .maybeSingle();
    const matchId = (match as { id: string } | null)?.id ?? null;
    // Notifications (spec/3D3.md): best-effort, never fail the swipe.
    // Mutual → one MATCH notification per member, no LIKE for this event.
    // Otherwise → one LIKE notification for the recipient.
    try {
      if (matchId) {
        await Promise.all([
          supabase.rpc("create_notification", { p_user_id: user.id, p_actor_id: toUserId, p_type: "MATCH", p_reference_id: matchId }),
          supabase.rpc("create_notification", { p_user_id: toUserId, p_actor_id: user.id, p_type: "MATCH", p_reference_id: matchId }),
        ]);
      } else if (likeId) {
        await supabase.rpc("create_notification", { p_user_id: toUserId, p_actor_id: user.id, p_type: "LIKE", p_reference_id: likeId });
      }
    } catch {
      // Notification failures must never break the like/match itself.
    }
    return { matched: !!match };
  } else {
    const { error } = await supabase.from("passes").insert({ from_user_id: user.id, to_user_id: toUserId });
    if (error && error.code !== "23505" && !error.message.includes("duplicate"))
      return { matched: false, error: error.message };
    return { matched: false };
  }
}
