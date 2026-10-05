import type { OnboardingStep } from "@/lib/onboarding/state";

/**
 * Safe `?next=` return-URL validation for the login flow (STEP: login `next`).
 *
 * Pure string logic, no I/O — safe to use server-side (API routes) and
 * client-side (already-signed-in branch of /login mirrors the same check;
 * destination pages re-guard server-side, so authority stays server-side).
 *
 * deliberately NOT just `startsWith("/")`: protocol-relative (`//evil`),
 * absolute (`https://evil`), scheme (`javascript:…`), backslash, and
 * single-/double-encoded variants are all rejected. Invalid input returns
 * null so callers treat it as absent — never an error, never a signal about
 * why it was rejected.
 */

const MAX_NEXT_LENGTH = 2048;

// Literal characters that never appear in a login return URL. Checked on the
// raw input AND after decoding (so %20 / %5C forms are caught too).
const UNSAFE_RE = /[\s\\<>"'`\u0000-\u001f\u007f]/;

// Public profile URLs reuse the username format rule (3–30, URL-safe).
const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;

/** Strip a single trailing slash for matching (root stays "/"). */
function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Allowlisted internal destinations a login may return to. Product pages
 * only — never /login, /onboarding/* (owned by destinationForStep()),
 * /auth/*, /invite/* (public), or /inside (admin).
 */
function isAllowlistedPath(pathname: string): boolean {
  const path = stripTrailingSlash(pathname);
  if (path === "/") return true;
  if (path === "/home") return true;
  if (path === "/search") return true;
  if (path === "/profile" || path === "/profile/edit") return true;
  if (path === "/settings" || path === "/settings/account" || path === "/settings/password") return true;
  const publicProfile = path.match(/^\/u\/([^/]+)$/);
  if (publicProfile && USERNAME_RE.test(publicProfile[1])) return true;
  return false;
}

/**
 * Validate a raw `next` value. Returns the original (un-decoded) internal
 * path when it is a safe, allowlisted application path, else null.
 */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return null;
  if (UNSAFE_RE.test(raw)) return null;
  // Single leading slash only — rejects absolute URLs AND protocol-relative.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;

  // Fully decode (repeatedly, to catch %252F-style double encoding), then
  // re-apply every structural check on the decoded form.
  let decoded = raw;
  try {
    for (let i = 0; i < 4; i++) {
      const step = decodeURIComponent(decoded);
      if (step === decoded) break;
      decoded = step;
    }
  } catch {
    return null; // malformed encoding (lone % / bad hex) — treat as absent
  }
  if (UNSAFE_RE.test(decoded)) return null;
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.startsWith("/\\")) return null;
  // A scheme hiding behind the leading slash ("/javascript:…", "/http:…")
  // is still same-origin as a path, but no login destination uses ":" —
  // reject outright rather than reasoning about URL normalization.
  if (decoded.includes(":")) return null;

  // Parse against a dummy origin: anything that resolves to a different
  // host/protocol (absolute, protocol-relative, scheme) fails here even if
  // the string checks above missed a novel encoding of it.
  let url: URL;
  try {
    url = new URL(decoded, "http://internal");
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || url.host !== "internal") return null;

  if (!isAllowlistedPath(url.pathname)) return null;

  // Valid: return the ORIGINAL value (not the decoded form) so no
  // double-decoding can smuggle a different path through the redirect.
  return raw;
}

/**
 * Final login redirect decision. Guards stay authoritative:
 * - incomplete onboarding → existing fallback (step path), `next` ignored
 * - otherwise valid `next`, else existing fallback
 */
export function resolveLoginNext(args: {
  step: OnboardingStep;
  requestedNext: unknown;
  fallback: string;
}): string {
  if (args.step !== "complete") return args.fallback;
  const candidate = safeNextPath(args.requestedNext);
  if (!candidate) return args.fallback;
  return candidate;
}
