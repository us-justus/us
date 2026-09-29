import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeUSN } from "@/lib/verification/usn";
import { destinationForStep } from "@/lib/auth/redirect";
import { getOnboardingState } from "@/lib/onboarding/state";

/**
 * Second half of USN + email + password login.
 *
 * The client authenticates with email/password first (Supabase Auth owns
 * passwords; USN is never a password and never authenticates alone). This
 * route then verifies — server-side, from the session — that the submitted
 * USN belongs to the authenticated user via verification_records.user_id.
 *
 * The client-supplied user ID is never trusted; identity comes only from
 * supabase.auth.getUser(). The USN is never returned. Every failure,
 * whatever the cause, yields the same generic message so login never reveals
 * whether a USN or email exists.
 */
const GENERIC = "Incorrect USN, email, or password.";

export async function POST(req: Request) {
  const { usn } = await req.json().catch(() => ({}));
  const submitted = normalizeUSN(String(usn || ""));
  if (!submitted) return NextResponse.json({ error: GENERIC }, { status: 401 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: GENERIC }, { status: 401 });

  const { data: vr } = await supabase
    .from("verification_records")
    .select("usn")
    .eq("user_id", user.id)
    .maybeSingle();

  const stored = vr?.usn ? normalizeUSN(String(vr.usn)) : "";
  if (!stored || stored !== submitted) {
    // Do not leave a half-authenticated session behind.
    await supabase.auth.signOut();
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  // Reuse the already-authenticated user — never a second getUser().
  const { step } = await getOnboardingState(user);
  return NextResponse.json({ ok: true, next: destinationForStep(step) });
}
