/**
 * INSIDE v1 — signed `inside_admin` cookie construction/parsing constants.
 *
 * Server-only in practice (values bind ADMIN_SECRET_KEY signatures), but
 * this module itself is dependency-free on purpose so cookie flags/scope
 * stay unit-testable without a Next/request context.
 *
 * SCOPE DECISIONS (reviewed Step 1 hardening):
 *   - `Path=/` is the narrowest path that supports the architecture: the
 *     cookie is minted by `POST /api/inside/login`, verified on
 *     `GET /inside` (page) and `POST /api/inside/launch|logout`, and must
 *     therefore be sent to BOTH `/inside` and `/api/inside/*`. `Path=/inside`
 *     would stop the browser sending it to `/api/inside/*` and break the
 *     gate, so `/` is required — not a relaxation.
 *   - `HttpOnly` always: JS never needs to read the session proof.
 *   - `SameSite=Lax`: the dashboard is always same-site; Lax keeps the
 *     top-level `GET /inside` navigation working while cross-site POSTs
 *     (the CSRF shape) withhold the cookie. CSRF is additionally covered by
 *     the Origin-vs-Host check (`./origin`) on state-changing routes.
 *   - `Secure` in production only: local dev runs over plain http, where a
 *     Secure cookie would never be stored/sent and login would silently
 *     break. Production/staging serve https with NODE_ENV=production.
 *   - No `__Host-` prefix: `__Host-` REQUIRES `Secure`, which dev cannot
 *     set (see above) — browsers would reject the cookie over http and
 *     break local login. Revisit only if dev moves to https everywhere.
 *   - 12-hour `Max-Age` preserved: short enough to bound a stolen cookie,
 *     long enough for an admin workday; expiry is ALSO enforced
 *     server-side inside the signed payload (`exp`), so client clock games
 *     buy nothing.
 */

export const INSIDE_COOKIE = "inside_admin";

export const INSIDE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function cookieAttrs(maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${INSIDE_COOKIE}=__V__; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export function setInsideCookieHeader(value: string): string {
  const maxAge = Math.floor(INSIDE_SESSION_TTL_MS / 1000);
  return cookieAttrs(maxAge).replace("__V__", value);
}

export function clearInsideCookieHeader(): string {
  return cookieAttrs(0).replace("__V__", "");
}
