/**
 * Pure login-entry decision for `/login`.
 *
 * An anonymous Supabase session is an onboarding identity, never a sign-in:
 * `/login` must render its credential form whenever the server-decided
 * account kind is `anonymous` or there is no session at all. Resume
 * navigation (`SignedInContinue`) is permitted ONLY for a server-confirmed
 * non-anonymous (permanent-*) account, routed by the server-derived
 * onboarding step.
 *
 * Why the server kind, never the browser bit: `GET /api/account/state`
 * intentionally reports `signedIn: true` for anonymous Auth identities (they
 * are valid onboarding sessions), so any consumer that treats session
 * presence — or the raw browser `user.is_anonymous` bit — as proof of a
 * returning account diverts onboarding holders away from sign-in
 * (`/login` → `/onboarding/email` with no credential form ever rendered).
 * The raw browser bit is storage-derived and can disagree with the server
 * (stale/missing `is_anonymous` on a cached session user); `account.kind`
 * from `/api/account/state` is the sole navigation authority here.
 *
 * Fail-open: unknown server state (fetch failed), no session, an anonymous
 * kind, or an unrecognized shape all render the form. Signing in replaces
 * or refreshes whatever session exists, so the credential form is always
 * safe to show — it can never strand a user.
 *
 * No I/O, no imports — unit-testable under plain `node --test`.
 */

export type LoginServerSnapshot = {
  /** `signedIn` from /api/account/state. */
  signedIn: boolean;
  /** `account.kind` from /api/account/state. Null when signed-out/unknown. */
  accountKind: string | null;
};

export type LoginEntry = "form" | "continue";

/**
 * Decide what `/login` renders for this device.
 *
 * - `"form"` — render the credential form (anonymous, absent, unknown, or
 *   unrecognized server state). Never navigates.
 * - `"continue"` — server-confirmed non-anonymous account: the existing
 *   resume behavior (server-decided destination) applies.
 */
export function decideLoginEntry(server: LoginServerSnapshot | null): LoginEntry {
  if (!server || server.signedIn !== true) return "form";
  if (typeof server.accountKind !== "string" || server.accountKind === "anonymous") return "form";
  return "continue";
}

/**
 * Whether `/login` shows the guest-session notice above the credential form.
 * Keyed on the same server snapshot as the entry decision — never on the
 * raw browser `user.is_anonymous` bit (raw anonymity must not drive
 * navigation or messaging).
 */
export function showLoginGuestNotice(server: LoginServerSnapshot | null): boolean {
  return !!server && server.signedIn === true && server.accountKind === "anonymous";
}

/**
 * Project a raw `/api/account/state` JSON payload onto the narrow snapshot
 * the entry decision needs. Returns null when the payload is absent,
 * malformed, or not an authenticated response — every such case fails open
 * to the credential form via `decideLoginEntry()`.
 */
export function toLoginServerSnapshot(
  ok: boolean,
  payload: {
    signedIn?: unknown;
    account?: { kind?: unknown } | null;
  } | null,
): LoginServerSnapshot | null {
  if (!ok || !payload || payload.signedIn !== true) return null;
  const kind = payload.account?.kind;
  return { signedIn: true, accountKind: typeof kind === "string" ? kind : null };
}
