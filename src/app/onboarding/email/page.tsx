"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAnonymousSession } from "@/lib/auth/use-anonymous-session";
import { validateAccountEmail } from "@/lib/auth/account";
import { Shell, FieldError } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";

export default function EmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Shared bootstrap: restores the existing anonymous session, signs in only
  // when none exists. ensureAnonymousSession() remains the single place that
  // may establish a session.
  const { status: sessionStatus, retry: retrySession } = useAnonymousSession();

  async function submit() {
    if (sessionStatus !== "ready") return;
    const val = email.trim();
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

  return (
    <Shell title="student email." subtitle="Your email secures your account and lets you sign back in. We keep it private — it's never shown publicly." step="02 — email">
      <div className="space-y-5">
        <div>
          <label htmlFor="onboarding-email" className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">campus email</label>
          <input id="onboarding-email" name="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@campus.edu" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email" enterKeyHint="next"
            className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft" />
          {error && <FieldError msg={error} />}
        </div>
        <Button onClick={submit} disabled={loading || sessionStatus !== "ready"} className="w-full rounded-full">{loading ? "saving…" : "continue"}</Button>
        {sessionStatus === "initializing" && <p className="text-[12px] text-ink-faint">preparing your session…</p>}
        {sessionStatus === "error" && (
          <div className="space-y-3">
            <FieldError msg="We couldn't start your session. Please try again." />
            <Button onClick={retrySession} className="w-full rounded-full">
              Try again
            </Button>
          </div>
        )}
        <p className="text-[11px] leading-4 text-ink-faint">One email per account. You&apos;ll verify it on the next step.</p>
      </div>
    </Shell>
  );
}
