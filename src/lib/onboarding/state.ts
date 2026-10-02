import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getAccountState } from "@/lib/auth/account";
import { perfLog, perfStart } from "@/lib/utils/perf";

export type OnboardingStep = "usn" | "email" | "password" | "profile" | "photos" | "complete";

/**
 * Single source of onboarding truth (DB + auth state, never localStorage).
 *
 * Flow: usn → email → password → profile → photos → complete.
 * Email is OPTIONAL (STEP 3C): usn → email → skip → password → profile →
 * photos → complete is equally valid. Skipped-email accounts set a password
 * on an internal confirmed sign-in identity (server-attached, never shown).
 *
 * - `usn`: no verified USN on verification_records.
 * - `email`: USN present, no email recorded, and no explicit skip yet.
 * - `password`: email recorded but the Supabase Auth identity is not yet a
 *   verified permanent account (anonymous, or email-change pending), OR an
 *   explicit email skip without a permanent identity yet. The password step
 *   links the email to the CURRENT anonymous user (UID preserved, never
 *   signUp), verifies it, and sets the password; the skipped path attaches
 *   a confirmed internal identity plus the password via
 *   POST /api/onboarding/password (same UID, no email sent).
 *   Accounts that already built a profile (existing campus sessions) are
 *   grandfathered past this gate — they secure via Settings instead.
 * - `profile` / `photos` / `complete`: as before.
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
  // email_skipped arrives with the STEP 3C migration. If the remote schema
  // predates it, fall back to the legacy projection so the email path keeps
  // working (skip simply unavailable until the migration is applied).
  type VrRow = { usn: string | null; email: string | null; email_skipped?: boolean | null };
  let vr: VrRow | null = null;
  const full = await supabase
    .from("verification_records")
    .select("usn, email, email_skipped")
    .eq("user_id", userId)
    .maybeSingle();
  if (!full.error) {
    vr = full.data as unknown as VrRow | null;
  } else if (/email_skipped/i.test(full.error.message ?? "")) {
    const legacy = await supabase
      .from("verification_records")
      .select("usn, email")
      .eq("user_id", userId)
      .maybeSingle();
    if (!legacy.error) vr = legacy.data as unknown as VrRow | null;
  }
  if (!vr || !vr.usn) {
    return done("usn");
  }
  const skipped = vr.email_skipped === true;
  if (!vr.email && !skipped) {
    return done("email");
  }
  const { data: profile } = await supabase.from("profiles").select("id").eq("user_id", userId).maybeSingle();
  if (!profile) {
    // Gate new accounts on a verified permanent identity before they build a
    // profile. Existing campus sessions (profile already built) keep product
    // access and secure from Settings.
    const account = getAccountState(user);
    if (account?.kind !== "permanent-verified") {
      return done("password");
    }
    return done("profile");
  }
  const { count } = await supabase.from("profile_photos").select("id", { count: "exact", head: true }).eq("profile_id", profile.id);
  if (!count || count < 1) {
    return done("photos");
  }
  return done("complete");
}

export function stepPath(step: OnboardingStep): string {
  if (step === "complete") return "/discover";
  return `/onboarding/${step}`;
}
