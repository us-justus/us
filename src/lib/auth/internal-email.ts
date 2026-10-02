/**
 * Internal sign-in email for password-capable accounts without a user email.
 *
 * Supabase Auth cannot hold a password on an anonymous user without a
 * verified email/phone. To let email-skipped users set a password and sign
 * back in with USN + password, the server attaches a confirmed, non-routable
 * internal email derived deterministically from the authenticated UID:
 *
 *   u-<uidhex>@us.signin.invalid
 *
 * - UID comes exclusively from the authenticated session (never USN,
 *   username, or client input).
 * - Same auth.users.id preserved (admin update in place, never signUp).
 * - `.invalid` (RFC 2606) never routes; no email is ever sent.
 * - Never displayed to users: UI/API layers must pass auth emails through
 *   displayAccountEmail() which suppresses this class to null.
 */

const INTERNAL_DOMAIN = "us.signin.invalid";
const INTERNAL_RE = /^u-[0-9a-f]{32}@us\.signin\.invalid$/i;

/** Deterministic internal email for a given auth UID. */
export function toInternalEmail(uid: string): string {
  const hex = uid.replace(/-/g, "").toLowerCase();
  return `u-${hex}@${INTERNAL_DOMAIN}`;
}

/** True when the email is a synthesized internal sign-in identity. */
export function isInternalEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return INTERNAL_RE.test(email.trim());
}

/**
 * Display-safe projection: internal identities collapse to null so they are
 * never shown in UI or user-facing API responses. Real user emails pass
 * through unchanged.
 */
export function displayAccountEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  if (isInternalEmail(email)) return null;
  return email;
}
