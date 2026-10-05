/**
 * Minimal first-year email-replacement recovery (QUICK FIX).
 *
 * Bug: on the email-first track, a duplicate email is correctly rejected at
 * the Auth-link step (`updateUser({ email })` fails because the address is
 * already associated with another account), but `/onboarding/password` offered
 * no way back to the email entry UI — the user was trapped.
 *
 * Recovery: a quiet secondary action ("use a different email") returns the
 * user to `/onboarding/email?edit=1`. The email form stays editable and a
 * resubmit replaces the rejected address on the SAME UID via the existing
 * `POST /api/onboarding/email` upsert (session UID only, never a client UID,
 * never signUp, never a second verification_records row). Verification +
 * password are still required afterwards — no bypass.
 *
 * No I/O, no imports — unit-testable under plain `node --test`.
 */

export const EMAIL_EDIT_PARAM = "edit";

export type EmailEditStep = "usn" | "email" | "password" | "profile" | "photos" | "complete";

export type EmailEditAccountKind = "anonymous" | "permanent-unverified" | "permanent-verified" | null;

/** Canonical recovery destination — narrowly scoped explicit intent. */
export function buildEmailEditHref(): string {
  return `/onboarding/email?${EMAIL_EDIT_PARAM}=1`;
}

/**
 * True only for the explicit `?edit=1` intent. Accepts either a
 * URLSearchParams-like (`useSearchParams()`) or a plain server searchParams
 * record. Anything else (missing, `0`, `true`, arrays) is not an edit intent.
 */
export function isEmailEditIntent(
  input:
    | { get: (name: string) => string | null }
    | Record<string, string | string[] | undefined>
    | null
    | undefined,
): boolean {
  if (!input) return false;
  if (typeof (input as { get?: unknown }).get === "function") {
    return (input as { get: (name: string) => string | null }).get(EMAIL_EDIT_PARAM) === "1";
  }
  const v = (input as Record<string, string | string[] | undefined>)[EMAIL_EDIT_PARAM];
  return v === "1";
}

/**
 * Server-safe guard for SHOWING the recovery action.
 *
 * True only while the account sits on the password step and is NOT yet a
 * verified permanent identity (anonymous link phase or unverified pending
 * phase). False once verified (`permanent-verified`), and false on every
 * other step — so the edit path can never be used to skip verification or
 * the password requirement. The password gate (`getOnboardingState()` +
 * `/api/account/state`) remains authoritative; this only decides whether the
 * quiet secondary action is rendered.
 */
export function canShowEmailEdit(args: {
  step: EmailEditStep | string | null;
  accountKind: EmailEditAccountKind | string | null;
}): boolean {
  if (args.step !== "password") return false;
  return args.accountKind === "anonymous" || args.accountKind === "permanent-unverified";
}

/**
 * Matches Auth-link failures for an already-used address. Supabase surfaces
 * these with several wordings ("already registered", "already in use",
 * "already exists", "duplicate", …) — all must stay a clear rejection, never
 * a silent pass or a bypass.
 */
export function isDuplicateEmailLinkError(
  error: { message?: string | null; code?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  const msg = typeof error.message === "string" ? error.message.toLowerCase() : "";
  if (!msg) return false;
  return (
    msg.includes("duplicate") ||
    msg.includes("already registered") ||
    msg.includes("already in use") ||
    msg.includes("already exists") ||
    msg.includes("already associated") ||
    msg.includes("already been registered") ||
    msg.includes("email address is already")
  );
}

/**
 * Clear, stable message for a failed Auth-link attempt. Duplicate addresses
 * stay rejected with the same actionable copy the password step already
 * shows — the recovery action underneath is what changes, not the rejection.
 */
export function mapEmailLinkError(): string {
  return "This email can't be used right now. Try another.";
}

export type EmailReplacementDecision = { action: "replace" } | { action: "no-op-same" };

/**
 * Pure replacement rule: a different valid address replaces the stored one
 * (the API upserts onto the session UID — same user, same row). Submitting
 * the identical address is a no-op, never a bypass. Verification + password
 * still happen afterwards on the password step.
 */
export function decideEmailReplacement(args: {
  /** Currently recorded onboarding email (lowercased upstream, "" when none). */
  storedEmail: string;
  /** Newly submitted email (already trimmed + validated upstream). */
  submittedEmail: string;
}): EmailReplacementDecision {
  const a = args.storedEmail.trim().toLowerCase();
  const b = args.submittedEmail.trim().toLowerCase();
  if (a && a === b) return { action: "no-op-same" };
  return { action: "replace" };
}
