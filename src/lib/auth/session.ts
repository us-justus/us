import { createClient } from "@/lib/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

type EnsureResult = { session: Session | null; user: User | null; error: string | null };

let inflight: Promise<EnsureResult> | null = null;

export async function ensureAnonymousSession(): Promise<EnsureResult> {
  if (inflight) return inflight;
  inflight = (async (): Promise<EnsureResult> => {
    const supabase = createClient();
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        if (process.env.NODE_ENV !== "production") console.error("[session] getSession error", sessionError);
      }
      const existing = sessionData.session;
      if (existing?.user) {
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) return { session: existing, user: userData.user, error: null };
        return { session: existing, user: existing.user as unknown as User, error: null };
      }
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        return { session: existing, user: userData.user, error: null };
      }
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        if (process.env.NODE_ENV !== "production") console.error("[session] signInAnonymously error", error);
        const msg = error.message?.toLowerCase().includes("anonymous")
          ? "Anonymous sign-ins are disabled in Supabase. Enable them in Authentication > Configuration."
          : error.message;
        return { session: null, user: null, error: msg || "We couldn't start your session. Please try again." };
      }
      return { session: data.session, user: data.user, error: null };
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
  if (data.session?.user) {
    const { data: ud } = await supabase.auth.getUser();
    return { session: data.session, user: ud.user ?? (data.session.user as unknown as User), error: null };
  }
  const { data: ud } = await supabase.auth.getUser();
  if (ud.user) return { session: data.session, user: ud.user, error: null };
  return { session: null, user: null, error: null };
}

export function resetSessionInflight() {
  inflight = null;
}
