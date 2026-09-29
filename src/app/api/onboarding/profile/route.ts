import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateNickname, validateAge, validateYear, validateBranch, validateBio } from "@/lib/validation/profile";
import { perfLog, perfStart } from "@/lib/utils/perf";

export async function POST(req: Request) {
  const t = perfStart();
  const body = await req.json().catch(()=>null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { nickname, age, year, branch, bio, interests } = body;
  const nErr = validateNickname(String(nickname||"")); if (nErr) return NextResponse.json({ error: nErr }, { status: 400 });
  const aErr = validateAge(Number(age)); if (aErr) return NextResponse.json({ error: aErr }, { status: 400 });
  const yErr = validateYear(String(year||"")); if (yErr) return NextResponse.json({ error: yErr }, { status: 400 });
  const bErr = validateBranch(String(branch||"")); if (bErr) return NextResponse.json({ error: bErr }, { status: 400 });
  const bioErr = validateBio(String(bio||"")); if (bioErr) return NextResponse.json({ error: bioErr }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { error } = await supabase.from("profiles").upsert({
    user_id: user.id, nickname: String(nickname).trim(), age: Number(age), year: String(year), branch: String(branch), bio: bio ? String(bio).trim() : null, interests: Array.isArray(interests) ? interests.slice(0,8) : []
  }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: "Could not save profile." }, { status: 400 });
  perfLog("profile.save", t);
  return NextResponse.json({ ok: true });
}
