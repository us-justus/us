import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateAccountEmail } from "@/lib/auth/account";
import { perfLog, perfStart } from "@/lib/utils/perf";

/**
 * Onboarding email identity. EMAIL IS REQUIRED FOR EVERY ACCOUNT.
 *
 * NORMAL (USN verified first): USN → email (REQUIRED, verified) → password
 *   → profile → photos → complete.
 *
 * FIRST-YEAR / email-first (no USN yet): email (REQUIRED, verified) →
 *   password → profile → photos → complete. Entered via
 *   POST { emailFirst: true } (from the `/onboarding/usn` secondary
 *   affordance), which ensures a verification row exists without a USN.
 *
 * There is NO skip-email path. POST { skip: true } is rejected for every
 * account (410 Gone) and never records a skipped flag. Supplying an email
 * clears any legacy skip. The legacy column is read for compatibility
 * only — it never authorizes completion.
 *
 * - POST { emailFirst: true }: idempotent entry — ensures a row exists for
 *   the current UID (insert-if-missing only, never clobbers usn/email).
 * - POST { email }: validates format, records it, clears any prior skip.
 *   Linking/verifying it to the CURRENT anonymous user (UID preserved, never
 *   signUp) plus the password happens on the password step.
 * - POST { skip: true }: REMOVED — always rejected. Email is required.
 * - Stored on the private verification record only — never exposed publicly.
 *   GET returns own-row email + legacy skip observation plus track flags
 *   (`usnPresent` boolean only — never the USN value itself).
 *   `emailRequired` is ALWAYS true.
 */
export async function POST(req: Request) {
  const t = perfStart();
  const body = await req.json().catch(() => ({}));
  const emailFirst = body?.emailFirst === true;
  const skip = body?.skip === true;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  if (emailFirst) {
    // Idempotent entry: insert a bare row only when none exists. Never
    // upserts email/usn fields, so an existing normal-track row (USN, email)
    // is left untouched. A concurrent insert loses the unique race —
    // that just means the row now exists, which is the entire goal.
    const { data: existing } = await supabase
      .from("verification_records")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!existing) {
      const { error } = await supabase
        .from("verification_records")
        .insert({ user_id: user.id });
      if (error && error.code !== "23505" && !/duplicate/i.test(error.message ?? "")) {
        return NextResponse.json({ error: "Could not start email signup. Try again." }, { status: 400 });
      }
    }
    perfLog("onboarding.email.first", t);
    return NextResponse.json({ ok: true, emailFirst: true });
  }

  if (skip) {
    // Skip-email was removed: every account must supply + verify a real
    // email. Rejected for ALL tracks (including USN-anchored) — no new
    // skipped rows are ever created. Legacy rows remain observable via GET
    // but never authorize completion.
    perfLog("onboarding.email.skip-rejected", t);
    return NextResponse.json(
      { error: "An email is required — verification is required to continue.", emailRequired: true },
      { status: 410 },
    );
  }

  const val = body?.email ? String(body.email).trim() : "";
  // Empty here means "no email typed": email is required, point back.
  if (!val) {
    return NextResponse.json(
      { error: "Enter your email.", emailRequired: true },
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

/** Own recorded email + legacy skip observation + track flags (private; RLS-scoped). */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const full = await supabase
    .from("verification_records")
    .select("email, email_skipped, usn")
    .eq("user_id", user.id)
    .maybeSingle();
  if (full.error && /email_skipped/i.test(full.error.message)) {
    const legacy = await supabase
      .from("verification_records")
      .select("email, usn")
      .eq("user_id", user.id)
      .maybeSingle();
    const usnPresent = Boolean((legacy.data as { usn?: unknown } | null)?.usn);
    return NextResponse.json({
      email: (((legacy.data as { email?: unknown } | null)?.email as string | null) ?? null),
      // Legacy column unreadable here — report unskipped; skip is removed.
      emailSkipped: false,
      // Booleans only — the USN value itself never leaves the server.
      usnPresent,
      // Email is required on every track.
      emailRequired: true,
    });
  }
  const row = (full.data as { email?: unknown; email_skipped?: unknown; usn?: unknown } | null) ?? null;
  const usnPresent = Boolean(row?.usn);
  return NextResponse.json({
    email: ((row?.email as string | null) ?? null),
    // Legacy observation only — never authorizes completion.
    emailSkipped: row?.email_skipped === true,
    // Booleans only — the USN value itself never leaves the server.
    usnPresent,
    // Email is required on every track.
    emailRequired: true,
  });
}
