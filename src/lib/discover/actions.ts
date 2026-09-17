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
    if (error && !error.message.includes("duplicate")) return { matched: false, error: error.message };
    const { data: match } = await supabase
      .from("matches")
      .select("id")
      .or(`and(user_a_id.eq.${user.id},user_b_id.eq.${toUserId}),and(user_a_id.eq.${toUserId},user_b_id.eq.${user.id})`)
      .maybeSingle();
    // fallback: check via ordered pair
    if (match) return { matched: true };
    const a = user.id < toUserId ? user.id : toUserId;
    const b = user.id < toUserId ? toUserId : user.id;
    const { data: match2 } = await supabase.from("matches").select("id").eq("user_a_id", a).eq("user_b_id", b).maybeSingle();
    return { matched: !!match2 };
  } else {
    const { error } = await supabase.from("passes").insert({ from_user_id: user.id, to_user_id: toUserId });
    if (error && !error.message.includes("duplicate")) return { matched: false, error: error.message };
    return { matched: false };
  }
}
