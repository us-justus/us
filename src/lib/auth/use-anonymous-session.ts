"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureAnonymousSession } from "@/lib/auth/session";

export type AnonymousSessionStatus = "initializing" | "ready" | "error";

/**
 * Shared client-side session bootstrap.
 *
 * Single consumer wrapper around `ensureAnonymousSession()` — the one and only
 * place that may establish a session (restore first, `signInAnonymously()`
 * only when no session exists). Pages must use this hook instead of calling
 * Supabase auth APIs directly.
 *
 * Dev-only diagnostics log the authenticated user ID and readiness only.
 * Never logs tokens, keys, cookies, or other secrets.
 */
export function useAnonymousSession() {
  const [status, setStatus] = useState<AnonymousSessionStatus>("initializing");
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const initialize = useCallback(async () => {
    setStatus("initializing");
    setError(null);
    const result = await ensureAnonymousSession();
    if (!mounted.current) return;
    if (result.error || !result.session || !result.user) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[session] init failed", result.error ?? "missing session/user");
      }
      setUserId(null);
      setError(result.error ?? "We couldn't start your session. Please try again.");
      setStatus("error");
      return;
    }
    if (process.env.NODE_ENV !== "production") {
      console.log(`[session] user=${result.user.id} status=ready`);
    }
    setUserId(result.user.id);
    setStatus("ready");
  }, []);

  useEffect(() => {
    mounted.current = true;
    // Session bootstrap on mount: restores external Supabase auth state into
    // React state once. Not derived state — disable cascading-render warning.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void initialize();
    return () => {
      mounted.current = false;
    };
  }, [initialize]);

  return { status, userId, error, retry: initialize };
}
