/**
 * Pure onboarding-track decision for the USN vs email-first (first-year) paths.
 *
 * EMAIL IS REQUIRED FOR EVERY ACCOUNT. Both tracks converge on the same
 * verified-email tail:
 * - NORMAL: a `verification_records` row carrying a USN.
 *   USN → email (REQUIRED, verified) → password → profile → photos → complete.
 * - FIRST-YEAR: a row exists but carries NO USN.
 *   email (REQUIRED, verified) → password → profile → photos → complete.
 * - FRESH: no row at all — the user has not entered either path yet.
 *
 * There is NO skip-email path. `emailSkipped` is a legacy observation only:
 * it is accepted in the input type so historical rows still parse, but it
 * NEVER changes the outcome — a skipped/empty email always resolves to the
 * `email` step on both tracks.
 *
 * The marker for "email-first entered" is row existence without a USN: the
 * entry affordance on `/onboarding/usn` ensures a row exists before routing
 * to `/onboarding/email`, so a first-year user on the email step is never
 * bounced back to `usn` merely because `usn IS NULL`.
 *
 * No I/O, no imports — unit-testable under plain `node --test`.
 */

export type OnboardingTrack = "fresh" | "normal" | "email-first";

export type PreProfileStep = "usn" | "email" | "beyond-email";

export type TrackDecision = {
  track: OnboardingTrack;
  /**
   * - `usn`: collect the USN first (fresh accounts only).
   * - `email`: collect a REQUIRED verified email next.
   * - `beyond-email`: email stage satisfied — the caller continues with the
   *   shared tail (password gate → profile → photos → complete).
   */
  step: PreProfileStep;
  /** Always true past `usn`: email is required on every track. */
  emailRequired: boolean;
};

export function decideOnboardingTrack(args: {
  /** True when a verification_records row exists for this UID. */
  hasRecord: boolean;
  /** Stored USN (already normalized upstream, or null). */
  usn: string | null;
  /** Stored onboarding email, or null. */
  email: string | null;
  /** Legacy explicit email-skip flag — OBSERVED ONLY, never honored. */
  emailSkipped: boolean;
}): TrackDecision {
  const { hasRecord, usn, email } = args;
  // NB: `emailSkipped` is intentionally unread: there is no skip path.
  // Both "no email yet" and "legacy skipped" resolve to the `email` step,
  // so the flag cannot change the outcome. It stays in the input type so
  // historical rows still parse.
  void args.emailSkipped;
  const hasUsn = typeof usn === "string" && usn.length > 0;
  const hasEmail = typeof email === "string" && email.length > 0;

  // No row at all: the user has entered neither path — start at USN.
  if (!hasRecord) {
    return { track: "fresh", step: "usn", emailRequired: false };
  }

  // USN present: the normal student track. Email is REQUIRED — an empty
  // email (including a legacy skip) owes the email step.
  if (hasUsn) {
    if (!hasEmail) {
      return { track: "normal", step: "email", emailRequired: true };
    }
    return { track: "normal", step: "beyond-email", emailRequired: true };
  }

  // Row exists, USN absent: the email-first (first-year) track. Email is
  // REQUIRED — a legacy skip without a USN was never valid and resolves
  // back to the email step.
  if (hasEmail) {
    return { track: "email-first", step: "beyond-email", emailRequired: true };
  }
  return { track: "email-first", step: "email", emailRequired: true };
}

/**
 * Email-skip rule: skipping is NEVER allowed.
 *
 * Legacy signature preserved so old call sites still compile, but the
 * answer is unconditionally false — there is no USN-anchored exception.
 * The `/api/onboarding/email` `{ skip: true }` path rejects with 400/410.
 */
export function isEmailSkipAllowed(_args?: { usn: string | null }): boolean {
  void _args;
  return false;
}
