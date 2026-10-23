import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { normalizeUsername, USERNAME_MAX } from "@/lib/validation/username";
import { perfLog, perfStart } from "@/lib/utils/perf";

/**
 * Campus search.
 *
 * - Completed campus/permanent users only.
 * - Username-prefix only; no nickname search.
 * - Bounded query using the existing username index.
 * - Explicit public-field projection. user_id is used only for
 *   self/block exclusion and is stripped before responding.
 * - Never return USN, email, phone, or verification metadata.
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
  gender: string | null;
};

export async function GET(req: Request) {
  const t = perfStart();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const privileged = createServiceRoleClient();

  const session = await getProductSession(user);
  const guard = guardProductSession(session);

  if (guard) {
    if (session.suspended) {
      return NextResponse.json(
        { error: "This account is suspended.", suspended: true },
        { status: 403 },
      );
    }

    return NextResponse.json(
      { error: "Finish onboarding to search campus." },
      { status: 403 },
    );
  }

  const raw = new URL(req.url).searchParams.get("q") ?? "";
  let q = normalizeUsername(raw);

  if (q.startsWith("@")) q = normalizeUsername(q.slice(1));

  if (q.length < SEARCH_MIN || q.length > USERNAME_MAX) {
    return NextResponse.json({ results: [] as SearchResult[] });
  }

  if (!/^[A-Za-z0-9_]+$/.test(q)) {
    return NextResponse.json({ results: [] as SearchResult[] });
  }

  const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);

  const [blockedRes, blockedByRes] = await Promise.all([
    supabase.from("blocks").select("blocked_id").eq("blocker_id", user.id),
    supabase.from("blocks").select("blocker_id").eq("blocked_id", user.id),
  ]);

  const excluded = new Set<string>();

  for (const row of (blockedRes.data ?? []) as { blocked_id: string }[]) {
    excluded.add(row.blocked_id);
  }

  for (const row of (blockedByRes.data ?? []) as { blocker_id: string }[]) {
    excluded.add(row.blocker_id);
  }

  // gender is intentionally public; private identifiers remain excluded.
  const projection =
    "user_id, username, spot, nickname, age, year, branch, gender, is_active";

  const { data, error } =
    excluded.size > 0
      ? await privileged
          .from("profiles")
          .select(projection)
          .eq("is_active", true)
          .not("username", "is", null)
          .ilike("username", `${escaped}%`)
          .neq("user_id", user.id)
          .not("user_id", "in", `(${[...excluded].join(",")})`)
          .order("username", { ascending: true })
          .limit(SEARCH_LIMIT)
      : await privileged
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
      console.error("[search] query error", error.code);
    }

    return NextResponse.json(
      { error: "Search is unavailable right now." },
      { status: 500 },
    );
  }

  const results: SearchResult[] = (
    (data ?? []) as {
      username: string | null;
      spot: number | null;
      nickname: string;
      age: number;
      year: string;
      branch: string;
      gender: string | null;
    }[]
  )
    .filter((r) => r.username)
    .map((r) => ({
      username: r.username as string,
      spot: r.spot,
      nickname: r.nickname,
      age: r.age,
      year: r.year,
      branch: r.branch,
      gender: r.gender,
    }));

  perfLog("search.query", t);
  return NextResponse.json({ results });
}
