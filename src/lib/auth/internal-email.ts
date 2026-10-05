/**
 * LEGACY internal sign-in email — no new accounts may enter this state.
 *
 * EMAIL IS REQUIRED FOR EVERY ACCOUNT. This helper previously let
 * email-skipped users set a password and sign back in with USN + password
 * by attaching a confirmed, non-routable internal email derived
 * deterministically from the authenticated UID:
 *
 *   u-<uidhex>@us.signin.invalid
 *
 * The skip path is removed (`POST /api/onboarding/email { skip: true }`
 * → 410, `POST /api/onboarding/password` → 410, state machine never honors
 * `email_skipped`). This module remains ONLY so historical rows and the
 * login resolver keep parsing existing staging identities:
 * - `isInternalEmail()` / `displayAccountEmail()` stay authoritative
 *   (login rejects internal input; UI/API layers suppress it to null).
 * - `toInternalEmail()` must NOT be used to create new accounts.
 * - `.invalid` (RFC 2606) never routes; no email is ever sent.
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
