"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAnonymousSession } from "@/lib/auth/use-anonymous-session";
import { validateAccountEmail } from "@/lib/auth/account";
import { FieldError } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";

export function EmailForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [skipping, setSkipping] = useState(false);
  // Shared bootstrap: restores the existing anonymous session, signs in only
  // when none exists. ensureAnonymousSession() remains the single place that
  // may establish a session.
  const { status: sessionStatus, retry: retrySession } = useAnonymousSession();

  async function submit() {
    if (sessionStatus !== "ready") return;
    const val = email.trim();
    if (!val) {
      setError("Enter your email, or skip for now.");
      return;
    }
    const err = validateAccountEmail(val);
    if (err) { setError(err); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: val }) });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Failed");
      // Auth linking (email → current anonymous user, UID preserved) plus
      // verification and password happen on the next step.
      router.push("/onboarding/password");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Try again."); } finally { setLoading(false); }
  }

  async function skip() {
    if (sessionStatus !== "ready") return;
    setSkipping(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skip: true }) });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Failed");
      // Skipped: no user email is recorded. The password step attaches a
      // confirmed internal sign-in identity plus the chosen password to this
      // same user — the account becomes permanent and USN-sign-in capable.
      router.push("/onboarding/password");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Try again."); } finally { setSkipping(false); }
  }

  const busy = loading || skipping;

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="onboarding-email" className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">campus email <span className="normal-case tracking-normal lowercase">— optional</span></label>
        <input id="onboarding-email" name="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@campus.edu" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email" enterKeyHint="next"
          className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft" />
        {error && <FieldError msg={error} />}
      </div>
      <Button onClick={submit} disabled={busy || sessionStatus !== "ready"} className="w-full rounded-full">{loading ? "saving…" : "continue"}</Button>
      <Button onClick={skip} disabled={busy || sessionStatus !== "ready"} variant="subtle" className="w-full rounded-full">{skipping ? "skipping…" : "skip for now"}</Button>
      {sessionStatus === "initializing" && <p className="text-[12px] text-ink-faint">preparing your session…</p>}
      {sessionStatus === "error" && (
        <div className="space-y-3">
          <FieldError msg="We couldn't start your session. Please try again." />
          <Button onClick={retrySession} className="w-full rounded-full">
            Try again
          </Button>
        </div>
      )}
      <p className="text-[11px] leading-4 text-ink-faint">We keep your email private — it&apos;s never shown publicly. Skip and you&apos;ll still set a password next to secure your account.</p>
    </div>
  );
}
