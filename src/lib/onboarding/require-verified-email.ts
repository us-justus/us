import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRealVerifiedEmail } from "../auth/account.ts";
import { isInternalEmail } from "../auth/internal-email.ts";

/**
 * Server-side onboarding completion guard.
 *
 * EMAIL IS REQUIRED AND MUST BE VERIFIED FOR EVERY USER. Before allowing
 * profile/photos writes (the steps that advance toward `complete`), verify:
 *   1. an authenticated session exists,
 *   2. a real (non-internal) email is recorded on `verification_records`,
 *   3. the Supabase Auth email is real + confirmed
 *      (`email_confirmed_at IS NOT NULL` via `hasRealVerifiedEmail()`).
 *
 * Never trusts client-provided `emailVerified` / `email_verified` /
 * `emailSkipped` / `verified` / `complete` fields. Legacy `email_skipped`
 * rows fail check (2) and are rejected.
 *
 * Pure decision helper (unit-testable) + server I/O wrapper (route guard).
 */

export type VerifiedEmailDecision =
  | { ok: true }
  | { ok: false; error: string; status: 401 | 403 };

/** Pure check over already-loaded values — no I/O. */
export function decideVerifiedEmailForWrite(args: {
  /** True when a session user exists. */
  hasSession: boolean;
  /** Recorded onboarding email (`verification_records.email`), or null. */
  recordedEmail: string | null;
  /** The authenticated Supabase Auth user (for the canonical check). */
  authUser: User | null;
}): VerifiedEmailDecision {
  if (!args.hasSession || !args.authUser) {
    return { ok: false, error: "Not authenticated.", status: 401 };
  }
  const recorded = (args.recordedEmail ?? "").trim();
  if (!recorded || isInternalEmail(recorded)) {
    return { ok: false, error: "Verify your email to continue.", status: 403 };
  }
  if (!hasRealVerifiedEmail(args.authUser)) {
    return { ok: false, error: "Verify your email to continue.", status: 403 };
  }
  return { ok: true };
}

/**
 * Route guard: loads the caller's verification row + runs the pure check
 * against the already-authenticated user. Pass the user from
 * `auth.getUser()` so callers reuse it (no second `getUser()`).
 */
export async function requireVerifiedEmailForWrite(
  supabase: SupabaseClient,
  authUser: User | null,
): Promise<VerifiedEmailDecision> {
  if (!authUser) return { ok: false, error: "Not authenticated.", status: 401 };
  const { data: vr } = await supabase
    .from("verification_records")
    .select("email")
    .eq("user_id", authUser.id)
    .maybeSingle();
  const recordedEmail =
    vr && typeof (vr as { email?: unknown }).email === "string"
      ? ((vr as { email: string }).email ?? null)
      : null;
  return decideVerifiedEmailForWrite({ hasSession: true, recordedEmail, authUser });
}
