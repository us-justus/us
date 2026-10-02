import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateAccountEmail } from "@/lib/auth/account";
import { perfLog, perfStart } from "@/lib/utils/perf";

/**
 * Onboarding email identity. Email is OPTIONAL (STEP 3C): it enables
 * cross-device sign-in and email recovery, but a student without an email
 * can skip and still complete onboarding as a campus account.
 *
 * - POST { email }: validates format, records it, clears any prior skip.
 *   Linking/verifying it to the CURRENT anonymous user (UID preserved, never
 *   signUp) plus the password happens on the password step.
 * - POST { skip: true }: records an explicit skip (email NULL,
 *   email_skipped true). No user email is recorded and no verification is
 *   attempted. The password step then attaches a confirmed internal sign-in
 *   identity plus the chosen password to the same user (never derived from
 *   USN/username).
 * - Stored on the private verification record only — never exposed publicly.
 */
export async function POST(req: Request) {
  const t = perfStart();
  const body = await req.json().catch(() => ({}));
  const skip = body?.skip === true;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  if (skip) {
    const { error } = await supabase
      .from("verification_records")
      .upsert({ user_id: user.id, email: null, email_skipped: true }, { onConflict: "user_id" });
    if (error) {
      if (/email_skipped/i.test(error.message)) {
        return NextResponse.json(
          { error: "Skipping email isn't available right now. Please add an email." },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: "Could not save. Try again." }, { status: 400 });
    }
    perfLog("onboarding.email.skip", t);
    return NextResponse.json({ ok: true, skipped: true });
  }

  const val = body?.email ? String(body.email).trim() : "";
  // Empty here means "no email typed": point at the skip path, don't 400
  // with a message that reads as email-required.
  if (!val) {
    return NextResponse.json(
      { error: "Enter your email, or skip for now.", skippable: true },
      { status: 400 },
    );
  }
  const err = validateAccountEmail(val);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const { error } = await supabase
    .from("verification_records")
    .upsert({ user_id: user.id, email: val, email_skipped: false }, { onConflict: "user_id" });
  if (error) {
    if (/email_skipped/i.test(error.message)) {
      // Pre-migration schema: legacy projection still records the email.
      const retry = await supabase
        .from("verification_records")
        .upsert({ user_id: user.id, email: val }, { onConflict: "user_id" });
      if (retry.error) return NextResponse.json({ error: "Could not save email." }, { status: 400 });
      perfLog("onboarding.email", t);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Could not save email." }, { status: 400 });
  }
  perfLog("onboarding.email", t);
  return NextResponse.json({ ok: true });
}

/** Own recorded email + skip state only (private; RLS-scoped to the session user). */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const full = await supabase
    .from("verification_records")
    .select("email, email_skipped")
    .eq("user_id", user.id)
    .maybeSingle();
  if (full.error && /email_skipped/i.test(full.error.message)) {
    const legacy = await supabase
      .from("verification_records")
      .select("email")
      .eq("user_id", user.id)
      .maybeSingle();
    return NextResponse.json({
      email: ((legacy.data?.email as string | null) ?? null),
      emailSkipped: false,
    });
  }
  return NextResponse.json({
    email: ((full.data?.email as string | null) ?? null),
    emailSkipped: (full.data?.email_skipped as boolean | null) === true,
  });
}
