import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateAccountEmail } from "@/lib/auth/account";
import { perfLog, perfStart } from "@/lib/utils/perf";

/**
 * Onboarding email identity. Email is REQUIRED for a permanent
 * (login-capable) account: it is linked to the current anonymous user during
 * the password step (UID preserved, never signUp) and becomes the sign-in
 * identity alongside the password. Stored on the private verification record
 * only — never exposed publicly.
 */
export async function POST(req: Request) {
  const t = perfStart();
  const { email } = await req.json().catch(() => ({}));
  const val = email ? String(email).trim() : "";
  // No skip path: a permanent account cannot sign back in without an email.
  const err = validateAccountEmail(val);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { error } = await supabase.from("verification_records").upsert({ user_id: user.id, email: val }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: "Could not save email." }, { status: 400 });
  perfLog("onboarding.email", t);
  return NextResponse.json({ ok: true });
}

/** Own recorded email only (private; RLS-scoped to the session user). */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { data: vr } = await supabase.from("verification_records").select("email").eq("user_id", user.id).maybeSingle();
  return NextResponse.json({ email: (vr?.email as string | null) ?? null });
}
