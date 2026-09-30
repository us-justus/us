import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountState } from "@/lib/auth/account";
import { destinationForStep } from "@/lib/auth/redirect";
import { getOnboardingState } from "@/lib/onboarding/state";
import { getLaunchState } from "@/lib/auth/launch";

/**
 * Server source of truth for account + onboarding state.
 *
 * Returns only safe, displayable fields — never USN, auth user ID internals,
 * verification metadata, tokens, or passwords.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ signedIn: false as const });

  const account = getAccountState(user);
  // Pass the already-authenticated user so getOnboardingState() does not
  // pay for a second auth.getUser() round-trip on this request.
  // Onboarding state and launch state are independent — resolve together.
  const [{ step }, launch] = await Promise.all([getOnboardingState(user), getLaunchState()]);
  const next = destinationForStep(step);

  return NextResponse.json({
    signedIn: true as const,
    account,
    // Authenticated email identity only (from Supabase Auth, never the
    // onboarding profile email field).
    email: user.email ?? null,
    emailConfirmed: account?.emailConfirmed ?? false,
    onboardingStep: step,
    next,
    // Server-authoritative launch flag. launchAt (UTC) is display-only for
    // a future countdown — never authorization.
    launched: launch.launched,
    launchAt: launch.launchAt,
  });
}
