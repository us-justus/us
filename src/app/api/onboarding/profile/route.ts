import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateNickname, validateAge, validateYear, validateBranch, validateBio } from "@/lib/validation/profile";
import { normalizeUsername, validateUsername } from "@/lib/validation/username";
import { perfLog, perfStart } from "@/lib/utils/perf";

export async function POST(req: Request) {
  const t = perfStart();
  const body = await req.json().catch(()=>null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { nickname, age, year, branch, bio, interests, username } = body;
  const nErr = validateNickname(String(nickname||"")); if (nErr) return NextResponse.json({ error: nErr }, { status: 400 });
  const aErr = validateAge(Number(age)); if (aErr) return NextResponse.json({ error: aErr }, { status: 400 });
  const yErr = validateYear(String(year||"")); if (yErr) return NextResponse.json({ error: yErr }, { status: 400 });
  const bErr = validateBranch(String(branch||"")); if (bErr) return NextResponse.json({ error: bErr }, { status: 400 });
  const bioErr = validateBio(String(bio||"")); if (bioErr) return NextResponse.json({ error: bioErr }, { status: 400 });
  // Username uses the one shared rule (client + server agree). Uniqueness is
  // NOT checked here by format — the DB unique index is authoritative.
  const uErr = validateUsername(String(username ?? ""));
  if (uErr) return NextResponse.json({ error: uErr, field: "username" }, { status: 400 });
  const normalized = normalizeUsername(String(username ?? ""));
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // Ownership + idempotency: a user with a spot keeps it forever; a username
  // once set is immutable (exact-casing refresh of the same name allowed).
  const { data: existing, error: lookupError } = await supabase
    .from("profiles")
    .select("id, username, spot")
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupError) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[profile] lookup error", lookupError.code, lookupError.message);
    }
    return NextResponse.json({ error: "Could not load profile." }, { status: 500 });
  }
  const prev = existing as { id: string; username: string | null; spot: number | null } | null;
  if (prev?.username && prev.username.toLowerCase() !== normalized.toLowerCase()) {
    return NextResponse.json(
      { error: "Your username is already set and can't be changed.", field: "username" },
      { status: 409 },
    );
  }

  // Friendly pre-check (indexed equality lookup, never COUNT(*)) so an
  // obviously-taken name fails BEFORE a spot is consumed. Races remain
  // possible — the unique index below is authoritative. The pattern is
  // LIKE-escaped (`_` is a valid username char but a LIKE wildcard), and
  // ilike without wildcards is a case-insensitive equality match.
  const likePattern = normalized.replace(/[\\%_]/g, (m) => `\\${m}`);
  const { data: clash } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", likePattern)
    .neq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (clash) {
    return NextResponse.json(
      { error: "That username is taken — try another.", field: "username" },
      { status: 409 },
    );
  }

  // Idempotent #spot: reuse when present, else allocate exactly one via the
  // existing atomic allocator (never COUNT(*), never client-generated).
  let spot: number | null = prev?.spot ?? null;
  if (spot === null) {
    const { data: allocated, error: allocError } = await supabase.rpc("allocate_campus_spot");
    if (allocError || typeof allocated !== "number") {
      if (process.env.NODE_ENV !== "production") {
        console.error("[profile] spot allocation error", allocError?.code, allocError?.message);
      }
      return NextResponse.json({ error: "Could not reserve your spot. Try again." }, { status: 500 });
    }
    spot = allocated;
  }

  const { error } = await supabase.from("profiles").upsert({
    user_id: user.id, nickname: String(nickname).trim(), age: Number(age), year: String(year), branch: String(branch), bio: bio ? String(bio).trim() : null, interests: Array.isArray(interests) ? interests.slice(0,8) : [],
    username: normalized, spot,
  }, { onConflict: "user_id" });
  if (error) {
    // Unique-index violation = lost race on the same name. Clean 409; the
    // consumed spot number becomes a harmless gap (spots stay unique and
    // are never reassigned — no renumbering, no reuse).
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "That username is taken — try another.", field: "username" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Could not save profile." }, { status: 400 });
  }
  perfLog("profile.save", t);
  return NextResponse.json({ ok: true, username: normalized, spot });
}
