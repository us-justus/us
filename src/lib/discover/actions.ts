"use server";

import { createClient } from "@/lib/supabase/server";

export async function swipeAction(toUserId: string, direction: "like" | "pass"): Promise<{ matched: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { matched: false, error: "Not authenticated" };
  if (user.id === toUserId) return { matched: false, error: "Invalid target" };

  if (direction === "like") {
    const { error } = await supabase.from("likes").insert({ from_user_id: user.id, to_user_id: toUserId });
    if (error && error.code !== "23505" && !error.message.includes("duplicate"))
      return { matched: false, error: error.message };
    // Single match lookup: the OR covers both orderings, so no second
    // fallback query is needed.
    const { data: match } = await supabase
      .from("matches")
      .select("id")
      .or(`and(user_a_id.eq.${user.id},user_b_id.eq.${toUserId}),and(user_a_id.eq.${toUserId},user_b_id.eq.${user.id})`)
      .maybeSingle();
    return { matched: !!match };
  } else {
    const { error } = await supabase.from("passes").insert({ from_user_id: user.id, to_user_id: toUserId });
    if (error && error.code !== "23505" && !error.message.includes("duplicate"))
      return { matched: false, error: error.message };
    return { matched: false };
  }
}
