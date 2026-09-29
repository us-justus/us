import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getAccountState, type AccountState } from "@/lib/auth/account";
import { getOnboardingState, stepPath, type OnboardingStep } from "@/lib/onboarding/state";

/**
 * Product auth state model — the single server-side source of truth for
 * "where should this user go / what may they see".
 *
 * Distinct from raw Supabase auth:
 * - Supabase `is_anonymous = true` does NOT mean "logged in".
 * - Product state is determined by (a) whether any session exists,
 *   (b) whether onboarding is complete, (c) whether the account is permanent.
 *
 * States:
 * - public:     no session. Sees landing / login / onboarding entry only.
 * - onboarding: session exists but onboarding step != complete. Minimal header,
 *               no product nav, protected routes redirect to the step path.
 * - campus:     onboarding complete on a still-anonymous account. Full product
 *               nav; "secure your account" messaging belongs HERE.
 * - permanent:  onboarding complete on a verified/non-anonymous account.
 *               Full product nav + verified settings + sign out.
 */
export type ProductState = "public" | "onboarding" | "campus" | "permanent";

export type ProductSession = {
  state: ProductState;
  user: User | null;
  account: AccountState | null;
  step: OnboardingStep | null;
};

export async function getProductSession(knownUser?: User | null): Promise<ProductSession> {
  const supabase = await createClient();
  let user: User | null | undefined = knownUser;
  if (user === undefined) {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  }
  if (!user) {
    return { state: "public", user: null, account: null, step: null };
  }
  const account = getAccountState(user);
  // Reuse the already-authenticated user — never a second getUser().
  const { step } = await getOnboardingState(user);
  if (step !== "complete") {
    return { state: "onboarding", user, account, step };
  }
  if (account && account.kind !== "anonymous") {
    return { state: "permanent", user, account, step };
  }
  return { state: "campus", user, account, step };
}

/**
 * Guard for product routes (/discover, /matches, /chat, /profile,
 * /profile/edit server parts, /settings). Returns the redirect target, or
 * null when the session may use the product.
 *
 * - public (no session) → /login (never expose product, never mint a session)
 * - onboarding (incomplete) → appropriate /onboarding/* step
 * - campus / permanent → null (allowed)
 */
export function guardProductSession(session: ProductSession): string | null {
  if (session.state === "public") return "/login";
  if (session.state === "onboarding") {
    return stepPath(session.step ?? "usn");
  }
  return null;
}
