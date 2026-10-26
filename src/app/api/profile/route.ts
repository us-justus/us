import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  validateNickname,
  validateAge,
  validateYear,
  validateBranch,
  validateBio,
  parseGenderPatch,
} from "@/lib/validation/profile";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const privileged = createServiceRoleClient();

  const { data: profile, error } = await privileged
    .from("profiles")
    .select("id, nickname, age, year, branch, gender, bio, interests, username, spot")
    .eq("user_id", user.id)
    .maybeSingle();

  // Database failure is distinct from "no profile row": 500, not 200-null.
  // Never log tokens or secrets.
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[profile] fetch error", error.code);
    }
    return NextResponse.json({ error: "Could not fetch profile." }, { status: 500 });
  }

  if (process.env.NODE_ENV !== "production") {
    console.log(`[profile] profileExists=${profile !== null}`);
  }

  // Authenticated but no profile row means onboarding is not complete.
  if (!profile) return NextResponse.json({ profile: null, photos: [] });

  const { data: photos } = await privileged
    .from("profile_photos")
    .select("id, storage_path, display_order")
    .eq("profile_id", profile.id)
    .order("display_order", { ascending: true });

  const mapped = (photos ?? []).map((p) => ({
    id: p.id,
    storage_path: p.storage_path,
    display_order: p.display_order,
    url: privileged.storage.from("profile-photos").getPublicUrl(p.storage_path).data.publicUrl,
  }));

  // Return only profile fields intended for the signed-in user's own profile.
  // Never expose USN, email, or auth ID.
  return NextResponse.json({ profile, photos: mapped });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { nickname, age, year, branch, bio, interests, username, spot } = body;

  // Username and spot are immutable here; onboarding is their sole writer.
  if (username !== undefined || spot !== undefined) {
    return NextResponse.json(
      {
        error: "Username and spot can't be changed here.",
        field: username !== undefined ? "username" : "spot",
      },
      { status: 400 },
    );
  }

  const nErr = validateNickname(String(nickname ?? ""));
  if (nErr) return NextResponse.json({ error: nErr, field: "nickname" }, { status: 400 });

  const aErr = validateAge(Number(age));
  if (aErr) return NextResponse.json({ error: aErr, field: "age" }, { status: 400 });

  const yErr = validateYear(String(year ?? ""));
  if (yErr) return NextResponse.json({ error: yErr, field: "year" }, { status: 400 });

  const bErr = validateBranch(String(branch ?? ""));
  if (bErr) return NextResponse.json({ error: bErr, field: "branch" }, { status: 400 });

  // Omitted gender preserves the stored value (including NULL for legacy
  // profiles); an explicit value must be exact. Never coerce untrusted input.
  const genderPatch = parseGenderPatch(body);
  if (!genderPatch.ok) {
    return NextResponse.json(
      { error: genderPatch.error, field: "gender" },
      { status: 400 },
    );
  }

  const bioErr = validateBio(String(bio ?? ""));
  if (bioErr) return NextResponse.json({ error: bioErr, field: "bio" }, { status: 400 });

  let normalizedInterests: string[] = [];

  if (Array.isArray(interests)) {
    normalizedInterests = interests
      .map((s: unknown) => String(s).trim())
      .filter(Boolean)
      .slice(0, 8);
  } else if (typeof interests === "string") {
    normalizedInterests = interests
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const privileged = createServiceRoleClient();

  // Verify ownership server-side via the authenticated user's ID.
  const { data: existing, error: lookupError } = await privileged
    .from("profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (lookupError) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[profile] lookup error", lookupError.code);
    }
    return NextResponse.json({ error: "Could not load profile." }, { status: 500 });
  }

  if (process.env.NODE_ENV !== "production") {
    console.log(`[profile] profileExists=${existing !== null}`);
  }

  if (!existing) {
    return NextResponse.json(
      { error: "Profile not found. Complete onboarding first." },
      { status: 404 },
    );
  }

  const update: Record<string, unknown> = {
    nickname: String(nickname).trim(),
    age: Number(age),
    year: String(year),
    branch: String(branch),
    bio: bio ? String(bio).trim() : null,
    interests: normalizedInterests,
  };

  if (genderPatch.gender !== undefined) {
    update.gender = genderPatch.gender;
  }

  const { error } = await privileged
    .from("profiles")
    .update(update)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Could not save profile." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
