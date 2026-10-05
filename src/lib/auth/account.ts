import type { User } from "@supabase/supabase-js";
import { isInternalEmail } from "./internal-email.ts";

export { displayAccountEmail, isInternalEmail } from "./internal-email.ts";

export type AccountKind = "anonymous" | "permanent-unverified" | "permanent-verified";

export type AccountState = {
  kind: AccountKind;
  /** Authenticated email identity, if any. Null for anonymous users. */
  email: string | null;
  /** True when Supabase Auth has verified the email identity. */
  emailConfirmed: boolean;
};

/**
 * Single helper for determining account state from the Supabase Auth user.
 *
 * Source of truth is `user.is_anonymous` — never a database email field.
 * An onboarding `verification_records.email` is profile/verification data only
 * and must never be treated as proof of an authenticated email identity.
 */
export function getAccountState(user: User | null): AccountState | null {
  if (!user) return null;
  const isAnonymous = (user as User & { is_anonymous?: boolean }).is_anonymous === true;
  if (isAnonymous) {
    return { kind: "anonymous", email: null, emailConfirmed: false };
  }
  const email = user.email ?? null;
  // Supabase marks verified identities via confirmed_at / email_confirmed_at.
  const confirmedAt =
    (user as User & { email_confirmed_at?: string | null }).email_confirmed_at ??
    (user as unknown as { confirmed_at?: string | null }).confirmed_at ??
    null;
  const emailConfirmed = Boolean(confirmedAt) || user.confirmed_at != null;
  return {
    kind: emailConfirmed ? "permanent-verified" : "permanent-unverified",
    email,
    emailConfirmed,
  };
}

/**
 * Canonical onboarding completion identity check: a REAL verified email.
 *
 * EMAIL IS REQUIRED FOR EVERY ACCOUNT. The Supabase Auth user must hold a
 * non-internal email address with `email_confirmed_at IS NOT NULL`
 * (surfaced here as `permanent-verified` + a non-internal email).
 * Internal sign-in identities (`u-…@us.signin.invalid`, legacy skip path)
 * are NEVER real emails — they fail this check even when confirmed.
 *
 * Pure + unit-testable. Server completion guards must use this (never a
 * client-provided flag, never `verification_records.email_verified` alone).
 */
export function hasRealVerifiedEmail(user: User | null): boolean {
  const account = getAccountState(user);
  if (!account || account.kind !== "permanent-verified") return false;
  const email = account.email;
  if (!email || !email.trim()) return false;
  if (isInternalEmail(email)) return false;
  return account.emailConfirmed === true;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateAccountEmail(v: string): string | null {
  const s = v.trim();
  if (!s) return "Enter your email.";
  if (s.length > 254) return "Email too long.";
  if (!EMAIL_RE.test(s)) return "Enter a valid email.";
  return null;
}

export const MIN_PASSWORD_LENGTH = 8;

export function validateNewPassword(v: string): string | null {
  if (!v) return "Choose a password.";
  if (v.length < MIN_PASSWORD_LENGTH) return `At least ${MIN_PASSWORD_LENGTH} characters.`;
  if (v.length > 128) return "Keep it under 128 characters.";
  return null;
}
