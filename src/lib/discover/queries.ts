import { createClient } from "@/lib/supabase/server";
import type { DiscoverProfile } from "./types";
import { DISCOVER_LIMIT } from "./constants";

export async function getDiscoverProfiles(): Promise<DiscoverProfile[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [likesRes, passesRes, blocksRes, blockedByRes] = await Promise.all([
    supabase.from("likes").select("to_user_id").eq("from_user_id", user.id),
    supabase.from("passes").select("to_user_id").eq("from_user_id", user.id),
    supabase.from("blocks").select("blocked_id").eq("blocker_id", user.id),
    supabase.from("blocks").select("blocker_id").eq("blocked_id", user.id),
  ]);

  const excluded = new Set<string>([user.id]);
  for (const r of [likesRes, passesRes]) {
    for (const row of (r.data ?? []) as { to_user_id: string }[]) excluded.add(row.to_user_id);
  }
  for (const row of ((blocksRes.data ?? []) as { blocked_id: string }[])) excluded.add(row.blocked_id);
  for (const row of ((blockedByRes.data ?? []) as { blocker_id: string }[])) excluded.add(row.blocker_id);

  const excludedArr = [...excluded];

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("user_id, username, nickname, age, year, branch, bio, interests, is_active")
    .eq("is_active", true)
    .not("user_id", "in", `(${excludedArr.join(",")})`)
    .limit(DISCOVER_LIMIT * 2) as { data: { user_id: string; username: string | null; nickname: string; age: number; year: string; branch: string; bio: string | null; interests: string[] | null; is_active: boolean }[] | null; error: unknown };
  if (error || !profiles?.length) return [];

  const filtered = profiles.slice(0, DISCOVER_LIMIT);
  const profileIds = filtered.map((p) => p.user_id);

  const { data: profileRows } = await supabase.from("profiles").select("id, user_id").in("user_id", profileIds);
  const idByUserId = new Map<string, string>();
  for (const r of (profileRows ?? []) as { id: string; user_id: string }[]) idByUserId.set(r.user_id, r.id);

  const profileIdList = [...idByUserId.values()];
  const photosByProfileId = new Map<string, string[]>();
  if (profileIdList.length) {
    const { data: photos } = await supabase
      .from("profile_photos")
      .select("profile_id, storage_path, display_order")
      .in("profile_id", profileIdList)
      .order("display_order", { ascending: true });
    for (const ph of (photos ?? []) as { profile_id: string; storage_path: string }[]) {
      const arr = photosByProfileId.get(ph.profile_id) ?? [];
      const url = supabase.storage.from("profile-photos").getPublicUrl(ph.storage_path).data.publicUrl;
      arr.push(url);
      photosByProfileId.set(ph.profile_id, arr);
    }
  }

  const result: DiscoverProfile[] = [];
  for (const p of filtered as { user_id: string; username: string | null; nickname: string; age: number; year: string; branch: string; bio: string | null; interests: string[] | null }[]) {
    const pid = idByUserId.get(p.user_id);
    const photos = pid ? (photosByProfileId.get(pid) ?? []) : [];
    if (!photos.length) continue;
    result.push({
      userId: p.user_id,
      username: p.username ?? "",
      nickname: p.nickname,
      age: p.age,
      year: p.year,
      branch: p.branch,
      bio: p.bio,
      interests: p.interests ?? [],
      photos,
    });
  }
  return result;
}
