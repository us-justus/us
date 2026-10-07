import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { validateNickname, validateAge, validateYear, validateBranch, validateBio } from "@/lib/validation/profile";
import { normalizeUsername, validateUsername } from "@/lib/validation/username";
import { requireVerifiedEmailForWrite } from "@/lib/onboarding/require-verified-email";
import { perfLog, perfStart } from "@/lib/utils/perf";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  const t = perfStart();
  const body = (await req.json().catch(()=>null)) as Record<string, unknown> | null;
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

  // Admin exclusion: admin users must never consume a student waitlist spot
  // (username, #spot, or claim row). Checked via is_admin() on the session
  // client (auth.uid()-based, no client-supplied identity), before the
  // username pre-check and before allocate_campus_spot() so an admin consumes
  // nothing. Fail closed: an unknown role-check outcome never allocates.
  const { data: isAdmin, error: adminCheckError } = await supabase.rpc("is_admin");
  if (adminCheckError || isAdmin === true) {
    return NextResponse.json(
      { error: "This account can't create a student profile." },
      { status: 403 },
    );
  }

  const privileged = createServiceRoleClient();

  // Email-required completion guard: a real verified Auth email plus a
  // recorded onboarding email must exist before profile writes. Blocks
  // direct-API bypasses that skip email verification.
  const gate = await requireVerifiedEmailForWrite(supabase, user);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error, emailRequired: true }, { status: gate.status });
  }

  // Ownership + idempotency: a user with a spot keeps it forever; a username
  // once set is immutable (exact-casing refresh of the same name allowed).
  const { data: existing, error: lookupError } = await privileged
    .from("profiles")
    .select("id, username, spot")
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupError) {
    if (String(process.env.NODE_ENV) !== "production") {
      if (process.env.NODE_ENV !== "production") console.error("[profile] lookup error", lookupError.code);
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
  const { data: clash } = await privileged
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
      if (String(process.env.NODE_ENV) !== "production") {
        if (process.env.NODE_ENV !== "production") console.error("[profile] spot allocation error", allocError?.code);
      }
      return NextResponse.json({ error: "Could not reserve your spot. Try again." }, { status: 500 });
    }
    spot = allocated;
  }

  const { error } = await privileged.from("profiles").upsert({
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

  // Record referral attribution if an invite cookie is present.
  // This is the single point where a completed user is attributed to an inviter.
  // The referral is immutable after creation (enforced by the unique constraint
  // on invitee_user_id). Self-referrals are rejected by the function.
  const cookieStore = await cookies();
  const inviteToken = cookieStore.get("us_invite")?.value;
  if (inviteToken) {
    await supabase.rpc("record_referral", {
      p_invite_token: inviteToken,
      p_invitee_user_id: user.id,
    });
    // Clear the cookie after recording — attribution is now persisted server-side.
    cookieStore.delete("us_invite");
  }

  return NextResponse.json({ ok: true, username: normalized, spot });
}
