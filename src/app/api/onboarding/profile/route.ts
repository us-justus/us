
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  validateNickname,
  validateAge,
  validateYear,
  validateBranch,
  validateBio,
  validateGender,
} from "@/lib/validation/profile";
import { normalizeUsername, validateUsername } from "@/lib/validation/username";
import { requireVerifiedEmailForWrite } from "@/lib/onboarding/require-verified-email";
import { perfLog, perfStart } from "@/lib/utils/perf";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  const t = perfStart();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { nickname, age, year, branch, bio, interests, username, gender } = body;

  const nErr = validateNickname(String(nickname || ""));
  if (nErr) return NextResponse.json({ error: nErr }, { status: 400 });

  const aErr = validateAge(Number(age));
  if (aErr) return NextResponse.json({ error: aErr }, { status: 400 });

  const yErr = validateYear(String(year || ""));
  if (yErr) return NextResponse.json({ error: yErr }, { status: 400 });

  const bErr = validateBranch(String(branch || ""));
  if (bErr) return NextResponse.json({ error: bErr }, { status: 400 });

  const bioErr = validateBio(String(bio || ""));
  if (bioErr) return NextResponse.json({ error: bioErr }, { status: 400 });

  const gErr = validateGender(String(gender ?? ""));
  if (gErr) {
    return NextResponse.json({ error: gErr, field: "gender" }, { status: 400 });
  }

  // Username uses one shared rule for client and server. The database unique
  // index remains authoritative for uniqueness.
  const uErr = validateUsername(String(username ?? ""));
  if (uErr) {
    return NextResponse.json({ error: uErr, field: "username" }, { status: 400 });
  }

  const normalized = normalizeUsername(String(username ?? ""));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Admin exclusion: check is_admin() on the session client before the
  // username pre-check and profile upsert. Fail closed if the role check
  // returns an error. The completion boundary independently rejects admins.
  const { data: isAdmin, error: adminCheckError } = await supabase.rpc("is_admin");

  if (adminCheckError || isAdmin === true) {
    return NextResponse.json(
      { error: "This account can't create a student profile." },
      { status: 403 },
    );
  }

  const privileged = createServiceRoleClient();

  // Require a verified Auth email and recorded onboarding email before writes.
  const gate = await requireVerifiedEmailForWrite(supabase, user);

  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.error, emailRequired: true },
      { status: gate.status },
    );
  }

  // Ownership and idempotency: an existing username cannot be changed, and
  // an existing spot must be preserved.
  const { data: existing, error: lookupError } = await privileged
    .from("profiles")
    .select("id, username, spot")
    .eq("user_id", user.id)
    .maybeSingle();

  if (lookupError) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[profile] lookup error", lookupError.code);
    }

    return NextResponse.json({ error: "Could not load profile." }, { status: 500 });
  }

  const prev = existing as {
    id: string;
    username: string | null;
    spot: number | null;
  } | null;

  if (prev?.username && prev.username.toLowerCase() !== normalized.toLowerCase()) {
    return NextResponse.json(
      { error: "Your username is already set and can't be changed.", field: "username" },
      { status: 409 },
    );
  }

  // Friendly pre-check. LIKE characters are escaped; the database unique
  // index remains authoritative if concurrent requests race.
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

  // #spot is not allocated here. A new profile is written with spot NULL.
  // The permanent spot is minted at the completion boundary by
  // finalize_onboarding_completion() after the first durable photo commits.
  // Existing spots are preserved exactly; profile creation never allocates.
  const spot: number | null = prev?.spot ?? null;

  const { error } = await privileged.from("profiles").upsert(
    {
      user_id: user.id,
      nickname: String(nickname).trim(),
      age: Number(age),
      year: String(year),
      branch: String(branch),
      bio: bio ? String(bio).trim() : null,
      interests: Array.isArray(interests) ? interests.slice(0, 8) : [],
      gender: String(gender),
      username: normalized,
      spot,
    },
    { onConflict: "user_id" },
  );

  if (error) {
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
  const cookieStore = await cookies();
  const inviteToken = cookieStore.get("us_invite")?.value;

  if (inviteToken) {
    await supabase.rpc("record_referral", {
      p_invite_token: inviteToken,
      p_invitee_user_id: user.id,
    });

    cookieStore.delete("us_invite");
  }

  return NextResponse.json({ ok: true, username: normalized, spot });
}
