import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAccountState, hasRealVerifiedEmail } from "@/lib/auth/account";
import { isInternalEmail } from "@/lib/auth/internal-email";
import { decideOnboardingTrack } from "@/lib/onboarding/track-decision";
import { perfLog, perfStart } from "@/lib/utils/perf";

export type OnboardingStep = "usn" | "email" | "password" | "profile" | "photos" | "complete";

/**
 * Single source of onboarding truth (DB + auth state, never localStorage).
 *
 * EMAIL IS REQUIRED AND MUST BE VERIFIED FOR EVERY USER. Both tracks share
 * one verified-email tail:
 *
 * NORMAL (USN verified first):
 *   usn → email (REQUIRED, verified) → password → profile → photos → complete.
 *
 * FIRST-YEAR / email-first (no USN yet):
 *   email (REQUIRED, verified) → password → profile → photos → complete.
 *
 * There is NO skip-email path. A legacy `email_skipped` row is observed for
 * parsing only and NEVER honored — it resolves to the `email` step.
 *
 * Canonical completion identity (server-enforced, never client-provided):
 * the Supabase Auth user must hold a REAL non-internal email with
 * `email_confirmed_at IS NOT NULL` (`hasRealVerifiedEmail()`). The
 * `/auth/confirm` flow is the source of truth. `verification_records.email`
 * alone, a custom flag, or a `?verified=1` param is never sufficient.
 *
 * - `usn`: no verification row yet (neither path entered).
 * - `email`: no real recorded email yet (either track), OR a legacy skip.
 * - `password`: recorded email exists but the account still owes password
 *   setup — either the Auth identity is not yet a real verified permanent
 *   account (anonymous, email-change pending, or legacy internal identity),
 *   OR the email is verified but `password_set_at IS NULL` and no profile
 *   exists yet. The password step links the email to the CURRENT anonymous
 *   user (UID preserved, never signUp), verifies it, and sets the password.
 *   No email-verification grandfathering: even accounts with a profile owe
 *   the Auth gate until the email is real + confirmed. Password-setup
 *   grandfathering is profile-scoped only: an existing profile never
 *   returns to `password` (legacy accounts created before `password_set_at`
 *   existed keep their tail).
 * - `profile` / `photos` / `complete`: shared tail, reachable ONLY with a
 *   real verified Auth email plus the recorded email plus (for new
 *   accounts) a recorded `password_set_at`.
 *
 * Pass the already-authenticated User whenever the caller has it so this
 * never pays for a second auth.getUser() on one request.
 */
export async function getOnboardingState(
  knownUser?: User | null,
): Promise<{ user: { id: string } | null; step: OnboardingStep }> {
  const t = perfStart();
  const supabase = await createClient();
  let user: User | null = knownUser ?? null;
  if (!user) {
    const { data: { user: u } } = await supabase.auth.getUser();
    user = u;
  }
  if (!user) return { user: null, step: "usn" };
  const userId = user.id;
  const done = (step: OnboardingStep) => {
    perfLog("onboarding.state", t);
    return { user: { id: userId }, step };
  };
  // email_skipped is a legacy column. Read it when present so historical
  // rows still parse, but NEVER honor it — skip is not a valid state.
  // password_set_at is the server-owned password-setup proof (20261021000001).
  // Pre-migration rows read as NULL (owe the password step when verified
  // with no profile yet); existing profiles are grandfathered regardless.
  type VrRow = { usn: string | null; email: string | null; email_skipped?: boolean | null; password_set_at?: string | null };
  let vr: VrRow | null = null;
  const full = await supabase
    .from("verification_records")
    .select("usn, email, email_skipped, password_set_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!full.error) {
    vr = full.data as unknown as VrRow | null;
  } else if (/password_set_at/i.test(full.error.message ?? "")) {
    // Pre-migration schema: retry without the new column (treated as NULL
    // below — verified users with no profile owe the password step).
    const legacy = await supabase
      .from("verification_records")
      .select("usn, email, email_skipped")
      .eq("user_id", userId)
      .maybeSingle();
    if (!legacy.error) {
      vr = legacy.data as unknown as VrRow | null;
    } else if (/email_skipped/i.test(legacy.error.message ?? "")) {
      const ancient = await supabase
        .from("verification_records")
        .select("usn, email")
        .eq("user_id", userId)
        .maybeSingle();
      if (!ancient.error) vr = ancient.data as unknown as VrRow | null;
    }
  } else if (/email_skipped/i.test(full.error.message ?? "")) {
    const legacy = await supabase
      .from("verification_records")
      .select("usn, email")
      .eq("user_id", userId)
      .maybeSingle();
    if (!legacy.error) vr = legacy.data as unknown as VrRow | null;
  }
  // Pure track decision: fresh (no row) → `usn`; missing email (including
  // legacy skip) → `email` on BOTH tracks; recorded email → `beyond-email`.
  // A legacy internal Auth email never counts as a recorded email here —
  // verification_records.email holds only real user input (NULL for skips).
  const rawEmail = typeof vr?.email === "string" ? vr.email.trim() : "";
  const recordedEmail = rawEmail && !isInternalEmail(rawEmail) ? vr?.email ?? null : null;
  const decision = decideOnboardingTrack({
    hasRecord: vr !== null,
    usn: vr?.usn ?? null,
    email: recordedEmail,
    emailSkipped: vr?.email_skipped === true,
  });
  if (decision.step !== "beyond-email") {
    return done(decision.step);
  }
  // Beyond-email still owes the email step when no real email is recorded
  // (defensive: the pure decision already covers this).
  if (!recordedEmail) {
    return done("email");
  }
  // Canonical gate: Supabase Auth must hold a REAL confirmed email.
  // No grandfathering past this — even accounts with a profile/photos owe
  // verification until `email_confirmed_at IS NOT NULL` on a non-internal
  // address. Client flags are never trusted.
  if (!hasRealVerifiedEmail(user)) {
    // Keep the single authoritative account read for observability; the
    // boolean above is the gate.
    void getAccountState(user);
    return done("password");
  }
  let privileged;
  try { privileged = createServiceRoleClient(); } catch { return done("password"); }
  const { data: profile } = await privileged.from("profiles").select("id").eq("user_id", userId).maybeSingle();
  // Grandfather: an existing profile never returns to the password step
  // (covers accounts completed before password_set_at existed).
  if (profile) {
    const { count } = await supabase.from("profile_photos").select("id", { count: "exact", head: true }).eq("profile_id", (profile as { id: string }).id);
    if (!count || count < 1) {
      return done("photos");
    }
    return done("complete");
  }
  // Verified email but no password proof and no profile yet: the account
  // still owes password setup. This is the authoritative gate that keeps the
  // verification-link flow (?verified=1) on the password step instead of
  // bouncing to profile before a password is set. Client flags are never
  // trusted.
  if (!vr?.password_set_at) {
    return done("password");
  }
  return done("profile");
}

export function stepPath(step: OnboardingStep): string {
  // Waiting home (/home) is a protected product route; / remains the public landing.
  if (step === "complete") return "/home";
  return `/onboarding/${step}`;
}
