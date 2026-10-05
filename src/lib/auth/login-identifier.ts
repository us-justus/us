import { normalizeUSN, validateUSN } from "../verification/usn.ts";
import { isInternalEmail } from "./internal-email.ts";
import { normalizeLoginEmail } from "./login-rate-limit.ts";

export type LoginIdentifier =
  | { kind: "usn"; usn: string }
  | { kind: "email"; email: string }
  | { kind: "invalid" };

// Mirrors validateAccountEmail() (src/lib/auth/account.ts) without importing
// it: that module uses the `@/` alias, which plain `node --test` cannot
// resolve. Keep the two in sync — well-formed address, same length bound.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isWellFormedEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return EMAIL_RE.test(email);
}

/**
 * SLICE 3 — server-side login identifier classification.
 *
 * Pure string logic, no I/O. The USN path is checked exactly as before
 * (normalize + college-format validation); anything that is not a valid USN
 * but is a well-formed, non-internal email takes the email path. Internal
 * sign-in identities (`u-…@us.signin.invalid`) are NEVER valid login input —
 * those accounts sign in via the USN path, and the internal address is never
 * displayed anywhere, so accepting it here would only leak the scheme.
 *
 * `invalid` covers empty, overlong, malformed, and internal-identity input.
 * Callers map every `invalid` to the single generic 401 — never a signal
 * about which shape failed or whether an email exists.
 */
export function classifyLoginIdentifier(raw: unknown): LoginIdentifier {
  if (typeof raw !== "string") return { kind: "invalid" };
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 254) return { kind: "invalid" };
  if (trimmed.includes("@")) {
    const email = normalizeLoginEmail(trimmed);
    if (!isWellFormedEmail(email)) return { kind: "invalid" };
    if (isInternalEmail(email)) return { kind: "invalid" };
    return { kind: "email", email };
  }
  const usn = normalizeUSN(trimmed);
  if (!validateUSN(usn)) return { kind: "invalid" };
  return { kind: "usn", usn };
}
