/**
 * Pure session-mode decision for onboarding step forms.
 *
 * The server (`GET /api/account/state`, cookie-based) is the authority for
 * which case the client is in. The browser Supabase singleton can hold a
 * stale (often anonymous) session after a server-side sign-in — server
 * mutations never fire `onAuthStateChange` — so a step form must never
 * silently bootstrap an anonymous session when the server already holds a
 * returning permanent account past this step.
 *
 * - New anonymous onboarding (server signed-out, or server anonymous):
 *   `anonymous` — the caller bootstraps via `ensureAnonymousSession()`
 *   exactly as before. First-time USN registration is unchanged.
 * - Returning permanent account already past (or before) this step:
 *   `existing` + `redirectTo` — the caller navigates to the server-decided
 *   destination and never enables submit. Submit is blocked, so a stale
 *   anonymous browser UID can never be used for an onboarding mutation.
 * - Returning permanent account genuinely on this step: `existing` —
 *   the caller resumes via `getExistingSession()` (never mints) and the
 *   server remains authoritative for the mutation itself.
 *
 * No I/O, no imports — unit-testable under plain `node --test`.
 */

export type OnboardingStepSlug = "usn" | "email" | "password" | "profile" | "photos" | "complete";

export type OnboardingServerSnapshot = {
  signedIn: boolean;
  /** `account.kind` from /api/account/state. Null when unknown/signed-out. */
  accountKind: "anonymous" | "permanent-unverified" | "permanent-verified" | null;
  /** `onboardingStep` from /api/account/state. Null when unknown/signed-out. */
  step: OnboardingStepSlug | null;
  /** `next` from /api/account/state. Null when unknown/signed-out. */
  next: string | null;
};

export type OnboardingBrowserSnapshot = {
  hasSession: boolean;
  isAnonymous: boolean;
} | null;

export type OnboardingSessionDecision =
  | { mode: "anonymous"; redirectTo: null; allowSubmit: true }
  | { mode: "existing"; redirectTo: null; allowSubmit: true }
  | { mode: "existing"; redirectTo: string; allowSubmit: false };

export function decideOnboardingSession(args: {
  /** The step slug whose form is asking (e.g. "usn"). */
  expectedStep: OnboardingStepSlug;
  /** Server truth from /api/account/state, or null when the fetch failed. */
  server: OnboardingServerSnapshot | null;
  /**
   * Browser snapshot. Informational only — the server always decides.
   * Callers may pass null when the browser session has not been peeked yet;
   * redirect/no-submit outcomes never depend on it.
   */
  browser: OnboardingBrowserSnapshot;
}): OnboardingSessionDecision {
  const { expectedStep, server } = args;

  // Unknown server state (fetch failed) or no session, or a genuinely
  // anonymous onboarding identity: legacy anonymous bootstrap. The server
  // stays authoritative for the mutation itself (cookie UID wins; a
  // mismatched caller gets a safe 401/409, never a wrong-UID write).
  if (!server || !server.signedIn || server.accountKind === "anonymous") {
    return { mode: "anonymous", redirectTo: null, allowSubmit: true };
  }

  // Signed-in non-anonymous account (permanent, verified or not, or an
  // unrecognized-but-signed-in shape — never mint in that direction).
  // When the server already places this account on a different step, the
  // form for `expectedStep` must not render submittable state at all.
  if (server.step && server.step !== expectedStep) {
    return {
      mode: "existing",
      redirectTo: server.next ?? `/onboarding/${server.step}`,
      allowSubmit: false,
    };
  }

  // Permanent account genuinely on this step (or an unparseable step):
  // resume the existing session, never mint. Mutations authenticate via
  // server cookies regardless of what the browser singleton holds.
  return { mode: "existing", redirectTo: null, allowSubmit: true };
}
