import type { SupabaseClient } from "@supabase/supabase-js";
import { getSeenMap } from "./read-state";

export type ConversationListItem = {
  /** matches.id — the only identifier the client ever sees. Never a user ID. */
  matchId: string;
  matchedAt: string;
  /** Public identity of the OTHER participant. Null when unknown/removed. */
  username: string | null;
  nickname: string | null;
  age: number | null;
  year: string | null;
  branch: string | null;
  /** Primary public photo of the other participant, if any. */
  photo_url: string | null;
  /** Latest message in this match, if any. Null when never messaged. */
  lastBody: string | null;
  lastAt: string | null;
  /** True when the current user sent the latest message. */
  lastIsOwn: boolean;
  /**
   * True when the latest message was sent by the OTHER user and is newer
   * than the viewer's read cursor (or no cursor exists yet). Own-only and
   * never-messaged conversations are never unread. A message never creates
   * a notification — this flag is the only inbox unread signal.
   */
  unread: boolean;
};

const MATCHES_LIMIT = 100;
// Bounded latest-message lookup: one query across all of the caller's
// matches, newest first. Grouped per-match in code; the first row per match
// is its latest message. Cap keeps the payload small (4 narrow columns).
const INBOX_MESSAGES_LIMIT = 200;

type MatchRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
};

/**
 * Server-side conversation inbox for one user.
 *
 * Data path (5 batched queries, no N+1, no per-match requests):
 *  1. matches where the caller is user_a OR user_b (matches RLS enforces
 *     the same membership server-side).
 *  2. One profiles lookup for all other-participant user_ids (public
 *     fields only — never USN/email/auth ID).
 *  3. One profile_photos lookup for those profiles ordered by
 *     display_order ASC; the first row per profile is the primary photo.
 *  4. One bounded messages lookup across all match ids, newest first;
 *     grouped per-match in code so each conversation carries its latest
 *     message (messages "own messages select" RLS enforces membership).
 *  5. One batched chat_read_state lookup for those match ids; each row's
 *     unread flag compares the latest message id against the cursor.
 *
 * Sort: conversations with messages first (latest message desc), then
 * never-messaged matches (match created_at desc).
 *
 * Runs under the existing RLS policies — no weakening, no migration.
 */
export async function getConversations(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ conversations: ConversationListItem[]; hasMatches: boolean; error: string | null }> {
  const { data: rows, error: matchesError } = await supabase
    .from("matches")
    .select("id, user_a_id, user_b_id, created_at")
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(MATCHES_LIMIT);

  if (matchesError) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[chat] inbox matches error", matchesError.code, matchesError.message);
    }
    return { conversations: [], hasMatches: false, error: "Could not load your conversations. Please try again." };
  }

  const matchRows = (rows ?? []) as MatchRow[];
  if (!matchRows.length) return { conversations: [], hasMatches: false, error: null };

  const otherIds = [...new Set(matchRows.map((m) => (m.user_a_id === userId ? m.user_b_id : m.user_a_id)))];
  const matchIds = matchRows.map((m) => m.id);

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, user_id, username, nickname, age, year, branch")
    .in("user_id", otherIds);

  if (profilesError) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[chat] inbox profiles error", profilesError.code, profilesError.message);
    }
    return { conversations: [], hasMatches: true, error: "Could not load your conversations. Please try again." };
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

  // Latest message per match: newest-first across all match ids, first row
  // per match wins. Bounded — never the full history, never per-match.
  // The id is needed for the read-cursor comparison (unread derivation).
  const latestByMatchId = new Map<string, { id: string; body: string; created_at: string; sender_id: string }>();
  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("id, match_id, sender_id, body, created_at")
    .in("match_id", matchIds)
    .order("created_at", { ascending: false })
    .limit(INBOX_MESSAGES_LIMIT);

  if (messagesError) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[chat] inbox messages error", messagesError.code, messagesError.message);
    }
    return { conversations: [], hasMatches: true, error: "Could not load your conversations. Please try again." };
  }

  for (const msg of (messages ?? []) as {
    id: string;
    match_id: string;
    sender_id: string;
    body: string;
    created_at: string;
  }[]) {
    if (latestByMatchId.has(msg.match_id)) continue;
    latestByMatchId.set(msg.match_id, { id: msg.id, body: msg.body, created_at: msg.created_at, sender_id: msg.sender_id });
  }

  // Read cursors for these matches: one batched query (no N+1). When the
  // lookup fails (e.g. pre-migration), readOk is false and every row renders
  // as read rather than erroring the inbox.
  const { seenByMatch, ok: readOk } = await getSeenMap(supabase, userId, matchIds);

  const conversations: ConversationListItem[] = [];
  for (const m of matchRows) {
    const otherId = m.user_a_id === userId ? m.user_b_id : m.user_a_id;
    const profile = profileByUserId.get(otherId);
    // Same rule as /matches: skip rows with no resolvable public identity
    // rather than render a dead entry. The match row itself is untouched.
    if (!profile) continue;
    const latest = latestByMatchId.get(m.id);
    const lastIsOwn = latest ? latest.sender_id === userId : false;
    const seenId = seenByMatch.get(m.id);
    conversations.push({
      matchId: m.id,
      matchedAt: m.created_at,
      username: profile.username,
      nickname: profile.nickname,
      age: profile.age,
      year: profile.year,
      branch: profile.branch,
      photo_url: photoByProfileId.get(profile.id) ?? null,
      lastBody: latest?.body ?? null,
      lastAt: latest?.created_at ?? null,
      lastIsOwn,
      unread: readOk && !!latest && !lastIsOwn && (seenId === undefined || seenId !== latest.id),
    });
  }

  // Messaged conversations first (latest message desc), then never-messaged
  // (match recency desc). matchRows arrived match-desc so the unmessaged tail
  // keeps that order; sort only to lift messaged rows above it (stable).
  conversations.sort((a, b) => {
    if (a.lastAt && b.lastAt) return b.lastAt.localeCompare(a.lastAt);
    if (a.lastAt) return -1;
    if (b.lastAt) return 1;
    return 0;
  });

  return { conversations, hasMatches: true, error: null };
}
