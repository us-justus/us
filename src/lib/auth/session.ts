import { createClient } from "@/lib/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { perfLog, perfStart } from "@/lib/utils/perf";

type EnsureResult = { session: Session | null; user: User | null; error: string | null };

let inflight: Promise<EnsureResult> | null = null;

export async function ensureAnonymousSession(): Promise<EnsureResult> {
  if (inflight) return inflight;
  inflight = (async (): Promise<EnsureResult> => {
    const supabase = createClient();
    const t = perfStart();
    try {
      // getSession() reads local storage only (no network). When there is no
      // local session, getUser() would just fail the same way, so skip it and
      // go straight to sign-in: saves one network round-trip on fresh visits.
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        if (process.env.NODE_ENV !== "production") console.error("[session] getSession error", sessionError);
      }
      const existing = sessionData.session;
      if (!existing?.user) {
        const { data, error } = await supabase.auth.signInAnonymously();
        perfLog("auth.anonymous", t);
        if (error) {
          if (process.env.NODE_ENV !== "production") console.error("[session] signInAnonymously error", error);
          const msg = error.message?.toLowerCase().includes("anonymous")
            ? "Anonymous sign-ins are disabled in Supabase. Enable them in Authentication > Configuration."
            : error.message;
          return { session: null, user: null, error: msg || "We couldn't start your session. Please try again." };
        }
        return { session: data.session, user: data.user, error: null };
      }
      // A local session exists: validate it server-side via getUser().
      const { data: userData } = await supabase.auth.getUser();
      perfLog("auth.anonymous", t);
      if (userData.user) return { session: existing, user: userData.user, error: null };
      return { session: existing, user: existing.user as unknown as User, error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "We couldn't start your session. Please try again.";
      if (process.env.NODE_ENV !== "production") console.error("[session] unexpected error", e);
      return { session: null, user: null, error: msg };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function getExistingSession(): Promise<EnsureResult> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  // No local session: no session to restore, skip the getUser() network call.
  if (!data.session?.user) return { session: null, user: null, error: null };
  const { data: ud } = await supabase.auth.getUser();
  return { session: data.session, user: ud.user ?? (data.session.user as unknown as User), error: null };
}

export function resetSessionInflight() {
  inflight = null;
}
