import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountState } from "@/lib/auth/account";
import { displayAccountEmail } from "@/lib/auth/internal-email";
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
  // Onboarding state, launch state, and the notification badge count are
  // independent — resolve together.
  const unreadQuery = supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null)
    .is("resolved_at", null)
    .is("deleted_at", null)
    .then(
      async (r) => {
        if (!r.error && typeof r.count === "number") return r.count;
        // Pre-resolved_at migration: fall back to the read/deleted-only count.
        if (r.error && !/resolved_at/i.test(r.error.message ?? "")) return 0;
        const legacy = await supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .is("read_at", null)
          .is("deleted_at", null);
        return typeof legacy.count === "number" ? legacy.count : 0;
      },
      () => 0,
    );
  const [{ step }, launch, unread] = await Promise.all([
    getOnboardingState(user),
    getLaunchState(),
    unreadQuery,
  ]);
  const next = destinationForStep(step);

  return NextResponse.json({
    signedIn: true as const,
    // Internal sign-in identities (u-…@us.signin.invalid) are never
    // exposed: the display projection collapses them to null.
    account: account ? { ...account, email: displayAccountEmail(account.email) } : account,
    // Authenticated email identity only (from Supabase Auth, never the
    // onboarding profile email field). Internal identities collapse to null.
    email: displayAccountEmail(user.email),
    emailConfirmed: account?.emailConfirmed ?? false,
    onboardingStep: step,
    next,
    // Server-authoritative launch flag. launchAt (UTC) is display-only for
    // a future countdown — never authorization.
    launched: launch.launched,
    launchAt: launch.launchAt,
    // Notification badge count (spec/3D3.md). Additive only — 0 until the
    // notifications migration is applied or when there is nothing unread.
    unreadCount: unread,
  });
}
