import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  validateNickname,
  validateAge,
  validateYear,
  validateBranch,
  validateBio,
} from "@/lib/validation/profile";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, nickname, age, year, branch, bio, interests")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Could not fetch profile." }, { status: 400 });
  if (!profile) return NextResponse.json({ profile: null, photos: [] });

  const { data: photos } = await supabase
    .from("profile_photos")
    .select("id, storage_path, display_order")
    .eq("profile_id", profile.id)
    .order("display_order", { ascending: true });

  const mapped = (photos ?? []).map((p) => ({
    id: p.id,
    storage_path: p.storage_path,
    display_order: p.display_order,
    url: supabase.storage.from("profile-photos").getPublicUrl(p.storage_path).data.publicUrl,
  }));

  // Only expose public fields — never USN/email/auth ID
  return NextResponse.json({ profile, photos: mapped });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const { nickname, age, year, branch, bio, interests } = body;

  const nErr = validateNickname(String(nickname ?? ""));
  if (nErr) return NextResponse.json({ error: nErr, field: "nickname" }, { status: 400 });
  const aErr = validateAge(Number(age));
  if (aErr) return NextResponse.json({ error: aErr, field: "age" }, { status: 400 });
  const yErr = validateYear(String(year ?? ""));
  if (yErr) return NextResponse.json({ error: yErr, field: "year" }, { status: 400 });
  const bErr = validateBranch(String(branch ?? ""));
  if (bErr) return NextResponse.json({ error: bErr, field: "branch" }, { status: 400 });
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
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // Verify ownership server-side via user_id = auth.uid()
  const { data: existing } = await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Profile not found. Complete onboarding first." }, { status: 404 });

  const { error } = await supabase
    .from("profiles")
    .update({
      nickname: String(nickname).trim(),
      age: Number(age),
      year: String(year),
      branch: String(branch),
      bio: bio ? String(bio).trim() : null,
      interests: normalizedInterests,
    })
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: "Could not save profile." }, { status: 400 });

  return NextResponse.json({ ok: true });
}
