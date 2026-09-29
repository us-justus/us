import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getAccountState } from "@/lib/auth/account";
import { perfLog, perfStart } from "@/lib/utils/perf";

export type OnboardingStep = "usn" | "email" | "password" | "profile" | "photos" | "complete";

/**
 * Single source of onboarding truth (DB + auth state, never localStorage).
 *
 * Flow: usn → email → password → profile → photos → complete.
 *
 * - `usn`: no verified USN on verification_records.
 * - `email`: USN present but no email. Email is REQUIRED for a permanent
 *   (login-capable) account — it secures the account and is the sign-in
 *   identity alongside the password.
 * - `password`: email recorded but the Supabase Auth identity is not yet a
 *   verified permanent account (anonymous, or email-change pending). The
 *   password step links the email to the CURRENT anonymous user (UID
 *   preserved, never signUp), verifies it, and sets the password.
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
  const { data: vr } = await supabase.from("verification_records").select("usn, email").eq("user_id", userId).maybeSingle();
  if (!vr || !vr.usn) {
    return done("usn");
  }
  if (!vr.email) {
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
