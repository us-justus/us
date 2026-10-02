import type { SupabaseClient } from "@supabase/supabase-js";

export type MatchListItem = {
  /** matches.id — the only identifier the client ever sees. Never a user ID. */
  id: string;
  created_at: string;
  /** Public identity of the OTHER participant. Null when unknown/removed. */
  username: string | null;
  nickname: string | null;
  age: number | null;
  year: string | null;
  branch: string | null;
  /** Primary public photo of the other participant, if any. */
  photo_url: string | null;
};

const MATCHES_LIMIT = 100;

type MatchRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
};

/**
 * Server-side matches list for one user.
 *
 * Data path (3 batched queries, no N+1, no per-match requests):
 *  1. matches where the caller is user_a OR user_b (RLS "own matches
 *     select" enforces the same membership server-side — the caller can
 *     never see another user's rows even if userId were confused).
 *  2. One profiles lookup for all other-participant user_ids (public
 *     fields only — never USN/email/auth ID).
 *  3. One profile_photos lookup for those profiles ordered by
 *     display_order ASC; the first row per profile is the primary photo.
 *
 * Runs under the existing RLS policies ("own matches select" +
 * "discover profiles select" + photos select) — no weakening, no migration.
 */
export async function getMatches(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ matches: MatchListItem[]; error: string | null }> {
  const { data: rows, error: matchesError } = await supabase
    .from("matches")
    .select("id, user_a_id, user_b_id, created_at")
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(MATCHES_LIMIT);

  if (matchesError) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[matches] list error", matchesError.code, matchesError.message);
    }
    return { matches: [], error: "Could not load your matches. Please try again." };
  }

  const matchRows = (rows ?? []) as MatchRow[];
  if (!matchRows.length) return { matches: [], error: null };

  const otherIds = [...new Set(matchRows.map((m) => (m.user_a_id === userId ? m.user_b_id : m.user_a_id)))];

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, user_id, username, nickname, age, year, branch")
    .in("user_id", otherIds);

  if (profilesError) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[matches] profiles error", profilesError.code, profilesError.message);
    }
    return { matches: [], error: "Could not load your matches. Please try again." };
  }

  const profileByUserId = new Map<
    string,
    { id: string; username: string | null; nickname: string; age: number; year: string; branch: string }
  >();
  for (const p of (profiles ?? []) as {
    id: string;
    user_id: string;
    username: string | null;
    nickname: string;
    age: number;
    year: string;
    branch: string;
  }[]) {
    profileByUserId.set(p.user_id, {
      id: p.id,
      username: p.username,
      nickname: p.nickname,
      age: p.age,
      year: p.year,
      branch: p.branch,
    });
  }

  // Primary photo per profile (first by display_order). One query for all
  // profiles — never one request per match, never all six photos shipped.
  const photoByProfileId = new Map<string, string>();
  const profileIds = [...profileByUserId.values()].map((p) => p.id);
  if (profileIds.length) {
    const { data: photos } = await supabase
      .from("profile_photos")
      .select("profile_id, storage_path, display_order")
      .in("profile_id", profileIds)
      .order("display_order", { ascending: true });
    const seen = new Set<string>();
    for (const ph of (photos ?? []) as { profile_id: string; storage_path: string }[]) {
      if (seen.has(ph.profile_id)) continue;
      seen.add(ph.profile_id);
      const url = supabase.storage.from("profile-photos").getPublicUrl(ph.storage_path).data.publicUrl;
      if (url) photoByProfileId.set(ph.profile_id, url);
    }
  }

  const matches: MatchListItem[] = [];
  for (const m of matchRows) {
    const otherId = m.user_a_id === userId ? m.user_b_id : m.user_a_id;
    const profile = profileByUserId.get(otherId);
    // A match whose counterpart profile no longer resolves (removed /
    // deactivated) carries no public identity to show — skip the row rather
    // than render a dead entry. The match row itself is untouched.
    if (!profile) continue;
    matches.push({
      id: m.id,
      created_at: m.created_at,
      username: profile.username,
      nickname: profile.nickname,
      age: profile.age,
      year: profile.year,
      branch: profile.branch,
      photo_url: photoByProfileId.get(profile.id) ?? null,
    });
  }

  return { matches, error: null };
}
