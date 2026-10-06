"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useOnboardingSession } from "@/lib/auth/use-onboarding-session";
import { normalizeUSN, validateUSN } from "@/lib/verification/usn";
import { FieldError } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";

export function UsnForm() {
  const router = useRouter();
  const [usn, setUsn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enteringEmailFirst, setEnteringEmailFirst] = useState(false);
  // Server-authoritative bootstrap: a new anonymous onboarding session
  // resumes/mints exactly as before, while a returning authenticated account
  // that belongs on a different step reports `redirectTo` — the form then
  // navigates to the server destination and never enables submit on the
  // stale browser UID. `ensureAnonymousSession()` remains the single place
  // that may establish a session.
  const { status: sessionStatus, redirectTo, retry: retrySession } = useOnboardingSession("usn");

  useEffect(() => {
    if (sessionStatus === "redirecting" && redirectTo) {
      router.replace(redirectTo);
    }
  }, [sessionStatus, redirectTo, router]);

  async function submit() {
    if (sessionStatus !== "ready") return;
    setError(null);
    const normalized = normalizeUSN(usn);
    if (!validateUSN(normalized)) {
      setError("Enter a valid USN.");
      return;
    }
    setLoading(true);
    try {
      // No ensureAnonymousSession() here: the hook above already bootstrapped
      // the session before enabling submit. Re-validating would add an extra
      // auth round-trip to the critical path; the API 401s safely if the
      // session is ever missing.
      const res = await fetch("/api/onboarding/usn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usn: normalized }),
      });
      const j = (await res.json()) as { error?: unknown } | null;
      if (!res.ok) throw new Error(typeof j?.error === "string" && j.error ? j.error : "Failed");
      router.push("/onboarding/email");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Try again.";
      if (process.env.NODE_ENV !== "production") console.error("[usn] submit error", e);
      if (msg.toLowerCase().includes("already") || msg.includes("duplicate")) setError("This USN is already associated with an account.");
      else if (msg.toLowerCase().includes("anonymous")) setError("We couldn't start your session. Please try again.");
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // Returning account that belongs elsewhere: follow the server destination.
  // No form is rendered, so no mutation can be issued as the wrong UID.
  if (sessionStatus === "redirecting") {
    return <p className="text-[13px] text-ink-soft">taking you to the right step…</p>;
  }

  /**
   * First-year / email-first entry (Slice 2): records the track choice
   * server-side (a verification row without a USN — the state machine reads
   * row-exists-without-USN as the email-first track, so refresh/re-entry
   * never bounces back to `usn`) and routes to the email step. Same UID,
   * same session — no signUp, no second identity. Subordinate to the USN
   * path by design: a quiet text action, never a competing CTA.
   */
  async function enterEmailFirst() {
    if (sessionStatus !== "ready" || enteringEmailFirst) return;
    setEnteringEmailFirst(true);
    try {
      const res = await fetch("/api/onboarding/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailFirst: true }),
      });
      const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) throw new Error(typeof j?.error === "string" ? j.error : "Try again.");
      router.push("/onboarding/email");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Try again.");
      setEnteringEmailFirst(false);
    }
  }

  const isContinueDisabled = loading || sessionStatus !== "ready";

  return (
    <div className="space-y-5">
      <div>
        <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">USN</label>
        <input
          value={usn}
          onChange={(e) => setUsn(e.target.value)}
          placeholder="e.g. 1AY22CS001"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base uppercase tracking-[0.08em] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
        {error && <FieldError msg={error} />}
      </div>
      <Button onClick={submit} disabled={isContinueDisabled} className="w-full rounded-full">
        {loading ? "verifying…" : "continue"}
      </Button>
      {sessionStatus === "initializing" && <p className="text-[12px] text-ink-faint">preparing your session…</p>}
      {sessionStatus === "error" && (
        <div className="space-y-3">
          <FieldError msg="We couldn't start your session. Please try again." />
          <Button onClick={retrySession} className="w-full rounded-full">
            Try again
          </Button>
        </div>
      )}
      <p className="text-[11px] leading-4 text-ink-faint">We only use this to confirm you&apos;re on campus. Never displayed publicly.</p>
      <div className="flex items-center gap-3 pt-1" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
      </div>
      <button
        type="button"
        onClick={enterEmailFirst}
        disabled={sessionStatus !== "ready" || enteringEmailFirst || loading}
        className="w-full py-2 text-[12px] tracking-[0.12em] uppercase text-ink-soft transition-colors hover:text-accent-deep hover:bg-accent-wash rounded-full min-h-[44px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
      >
        {enteringEmailFirst ? "starting…" : "don't have a USN yet? continue with email"}
      </button>
    </div>
  );
}
