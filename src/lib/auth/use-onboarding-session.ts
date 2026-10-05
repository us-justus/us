"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureAnonymousSession, getExistingSession } from "@/lib/auth/session";
import {
  decideOnboardingSession,
  type OnboardingServerSnapshot,
  type OnboardingStepSlug,
} from "@/lib/auth/onboarding-session-decision";

export type OnboardingSessionStatus = "initializing" | "ready" | "redirecting" | "error";

/**
 * Session bootstrap for onboarding step forms.
 *
 * Asks the server (`GET /api/account/state`, cookie-based) which case this
 * device is in, then follows the pure `decideOnboardingSession()` outcome:
 *
 * - new anonymous onboarding → `ensureAnonymousSession()` exactly as before
 *   (the single place that may mint a session);
 * - returning permanent account → `getExistingSession()` only (never mints),
 *   and when the server already places the account on a different step,
 *   reports `redirectTo` so the form navigates away instead of enabling
 *   submit on a stale browser UID.
 *
 * The server stays authoritative for every mutation; this hook only decides
 * which local bootstrap is safe and whether submit may be offered at all.
 */
export function useOnboardingSession(expectedStep: OnboardingStepSlug) {
  const [status, setStatus] = useState<OnboardingSessionStatus>("initializing");
  const [userId, setUserId] = useState<string | null>(null);
  const [redirectTo, setRedirectTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const initialize = useCallback(async () => {
    setStatus("initializing");
    setError(null);
    setRedirectTo(null);
    // Server truth first: signed-in state, account kind, onboarding step,
    // and the server-decided destination. Null when unreachable — the
    // decision falls back to the legacy anonymous bootstrap and the API
    // still authenticates via cookies.
    let server: OnboardingServerSnapshot | null = null;
    try {
      const res = await fetch("/api/account/state", { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (res.ok && j && typeof j.signedIn === "boolean") {
        const kind = j?.account?.kind;
        const step = j?.onboardingStep;
        server = {
          signedIn: j.signedIn === true,
          accountKind:
            kind === "anonymous" || kind === "permanent-unverified" || kind === "permanent-verified"
              ? kind
              : null,
          step:
            step === "usn" ||
            step === "email" ||
            step === "password" ||
            step === "profile" ||
            step === "photos" ||
            step === "complete"
              ? step
              : null,
          next: typeof j?.next === "string" ? j.next : null,
        };
      }
    } catch {
      server = null;
    }
    // The browser snapshot is intentionally not consulted for routing: the
    // singleton browser client can hold a stale anonymous session after a
    // server-side sign-in, so only the server decides redirect vs. submit.
    const decision = decideOnboardingSession({ expectedStep, server, browser: null });
    if (!mounted.current) return;
    if (decision.redirectTo) {
      // Never bootstrap (mint or resume) a local session for a returning
      // account that belongs on a different step — navigate to the server
      // destination instead. Submit stays disabled by construction.
      setRedirectTo(decision.redirectTo);
      setStatus("redirecting");
      return;
    }
    const result =
      decision.mode === "existing" ? await getExistingSession() : await ensureAnonymousSession();
    if (!mounted.current) return;
    if (result.error || !result.session || !result.user) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[onboarding-session] init failed", result.error ?? "missing session/user");
      }
      setUserId(null);
      setError(result.error ?? "We couldn't start your session. Please try again.");
      setStatus("error");
      return;
    }
    setUserId(result.user.id);
    setStatus("ready");
  }, [expectedStep]);

  useEffect(() => {
    mounted.current = true;
    // Session bootstrap on mount: server truth first, then the safe local
    // bootstrap once. Not derived state — disable cascading-render warning.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void initialize();
    return () => {
      mounted.current = false;
    };
  }, [initialize]);

  return { status, userId, redirectTo, error, retry: initialize };
}
