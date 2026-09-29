"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getExistingSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type ExistingSessionStatus = "initializing" | "ready" | "signed-out";

/**
 * Read-only session hook — restores the existing Supabase session and listens
 * for auth changes, but NEVER creates one.
 *
 * Use on /login, /settings, /settings/account, /auth/* — anywhere calling
 * ensureAnonymousSession()/useAnonymousSession() would mint an unwanted
 * anonymous user (e.g. a logged-out permanent user visiting /login).
 */
export function useExistingSession() {
  const [status, setStatus] = useState<ExistingSessionStatus>("initializing");
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const result = await getExistingSession();
    if (!mounted.current) return;
    setSession(result.session);
    setUser(result.user);
    setStatus(result.user ? "ready" : "signed-out");
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted.current) return;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setStatus(newSession?.user ? "ready" : "signed-out");
    });
    return () => {
      mounted.current = false;
      sub.subscription.unsubscribe();
    };
  }, [refresh]);

  return { status, session, user, refresh };
}
