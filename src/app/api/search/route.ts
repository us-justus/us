import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { normalizeUsername, USERNAME_MAX } from "@/lib/validation/username";
import { perfLog, perfStart } from "@/lib/utils/perf";

/**
 * Pre-launch campus search (STEP 3B).
 *
 * GET /api/search?q=@userna…
 *
 * - Completed campus/permanent users only (public → 401, incomplete → 403).
 * - No launch gate: search is a pre-launch feature that remains available
 *   once launched.
 * - Username-prefix only. Nickname search was never explicitly approved
 *   (SPEC.md §14.12), so username is the single lookup key.
 * - Bounded: hard cap SEARCH_LIMIT, minimum query length, prefix match only
 *   (no substring/fuzzy scan), served by the existing
 *   `idx_profiles_username_lower` index — no migration needed.
 * - Public fields only: the SELECT projection is explicit, `user_id` is
 *   resolved server-side for self/block exclusion and stripped before the
 *   response. Never USN/email/phone/auth ID/verification metadata.
 * - Runs under the existing "discover profiles select" RLS policy
 *   (authenticated). No new policy, no weakening, no SECURITY DEFINER.
 */
const SEARCH_LIMIT = 20;
const SEARCH_MIN = 2;

export type SearchResult = {
  username: string;
  spot: number | null;
  nickname: string;
  age: number;
  year: string;
  branch: string;
};

export async function GET(req: Request) {
  const t = perfStart();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // Reuse the known user — no second auth.getUser() on this request.
  const session = await getProductSession(user);
  const guard = guardProductSession(session);
  if (guard) {
    return NextResponse.json({ error: "Finish onboarding to search campus." }, { status: 403 });
  }

  const raw = new URL(req.url).searchParams.get("q") ?? "";
  // Accept a pasted "@name" — the @ is presentation, not identity.
  let q = normalizeUsername(raw);
  if (q.startsWith("@")) q = normalizeUsername(q.slice(1));

  // Minimum length (usernames are min 3): never scan the campus on empty
  // input. Short/illegal input returns empty results, not an error, so the
  // client keeps one code path.
  if (q.length < SEARCH_MIN) return NextResponse.json({ results: [] as SearchResult[] });
  if (q.length > USERNAME_MAX) return NextResponse.json({ results: [] as SearchResult[] });
  // Usernames are [A-Za-z0-9_] only — anything else can never match, and
  // rejecting it here keeps the DB query to the indexed username shape.
  if (!/^[A-Za-z0-9_]+$/.test(q)) return NextResponse.json({ results: [] as SearchResult[] });

  // LIKE-escape: `_` is a legal username char but a LIKE wildcard (same
  // pattern as POST /api/onboarding/profile). Prefix-only (`…%`): uses the
  // existing btree on lower(username), no pg_trgm, no substring scan.
  const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);

  // Block exclusion reuses the discover model: people you blocked and people
  // who blocked you are not publicly discoverable to you. Independent
  // queries — one phase, no waterfall.
  const [blockedRes, blockedByRes] = await Promise.all([
    supabase.from("blocks").select("blocked_id").eq("blocker_id", user.id),
    supabase.from("blocks").select("blocker_id").eq("blocked_id", user.id),
  ]);
  const excluded = new Set<string>();
  for (const row of (blockedRes.data ?? []) as { blocked_id: string }[]) excluded.add(row.blocked_id);
  for (const row of (blockedByRes.data ?? []) as { blocker_id: string }[]) excluded.add(row.blocker_id);

  // Explicit public-field projection. `user_id` is selected only to exclude
  // self/blocks server-side and is stripped before responding. Two terminal
  // chains (no builder reassignment) to keep the generated types finite.
  const projection = "user_id, username, spot, nickname, age, year, branch, is_active";
  const { data, error } =
    excluded.size > 0
      ? await supabase
          .from("profiles")
          .select(projection)
          .eq("is_active", true)
          .not("username", "is", null)
          .ilike("username", `${escaped}%`)
          .neq("user_id", user.id)
          .not("user_id", "in", `(${[...excluded].join(",")})`)
          .order("username", { ascending: true })
          .limit(SEARCH_LIMIT)
      : await supabase
          .from("profiles")
          .select(projection)
          .eq("is_active", true)
          .not("username", "is", null)
          .ilike("username", `${escaped}%`)
          .neq("user_id", user.id)
          .order("username", { ascending: true })
          .limit(SEARCH_LIMIT);
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[search] query error", error.code, error.message);
    }
    return NextResponse.json({ error: "Search is unavailable right now." }, { status: 500 });
  }

  const results: SearchResult[] = ((data ?? []) as {
    username: string | null;
    spot: number | null;
    nickname: string;
    age: number;
    year: string;
    branch: string;
  }[])
    .filter((r) => r.username)
    .map((r) => ({
      username: r.username as string,
      spot: r.spot,
      nickname: r.nickname,
      age: r.age,
      year: r.year,
      branch: r.branch,
    }));

  perfLog("search.query", t);
  return NextResponse.json({ results });
}
