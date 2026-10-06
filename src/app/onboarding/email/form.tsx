"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAnonymousSession } from "@/lib/auth/use-anonymous-session";
import { validateAccountEmail } from "@/lib/auth/account";
import { isEmailEditIntent } from "@/lib/onboarding/email-edit";
import { FieldError } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";

export function EmailForm() {
  return (
    <Suspense fallback={<p className="text-[13px] text-ink-soft">loading…</p>}>
      <EmailFormInner />
    </Suspense>
  );
}

function EmailFormInner() {
  const router = useRouter();
  const params = useSearchParams();
  // Explicit recovery intent from the password step (`?edit=1`): the
  // previously recorded address was rejected (duplicate) at the Auth-link
  // step. The field below stays fully editable — a resubmit replaces the
  // address on the SAME UID via the existing upsert, then continues through
  // the normal verification flow. Never a bypass: verification + password
  // are still required on the password step.
  const isEdit = isEmailEditIntent(params);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Email is REQUIRED for every account — there is no skip path and no
  // skip action is ever rendered.
  // Shared bootstrap: restores the existing anonymous session, signs in only
  // when none exists. ensureAnonymousSession() remains the single place that
  // may establish a session.
  const { status: sessionStatus, retry: retrySession } = useAnonymousSession();

  async function submit() {
    if (sessionStatus !== "ready") return;
    const val = email.trim();
    if (!val) {
      setError("Enter your email.");
      return;
    }
    const err = validateAccountEmail(val);
    if (err) { setError(err); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: val }) });
      const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) throw new Error(typeof j?.error === "string" && j.error ? j.error : "Failed");
      // Auth linking (email → current anonymous user, UID preserved) plus
      // verification and password happen on the next step.
      router.push("/onboarding/password");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Try again."); } finally { setLoading(false); }
  }

  const busy = loading;

  return (
    <div className="space-y-5">
      {isEdit && (
        <div className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
          <p className="text-[13px] leading-5 text-ink">That email couldn&apos;t be used — enter a different address.</p>
        </div>
      )}
      <div>
        <label htmlFor="onboarding-email" className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">campus email</label>
        <input id="onboarding-email" name="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@campus.edu" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email" enterKeyHint="next"
          className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft" />
        {error && <FieldError msg={error} />}
      </div>
      <Button onClick={submit} disabled={busy || sessionStatus !== "ready"} className="w-full rounded-full">{loading ? "saving…" : "continue"}</Button>
      {sessionStatus === "initializing" && <p className="text-[12px] text-ink-faint">preparing your session…</p>}
      {sessionStatus === "error" && (
        <div className="space-y-3">
          <FieldError msg="We couldn't start your session. Please try again." />
          <Button onClick={retrySession} className="w-full rounded-full">
            Try again
          </Button>
        </div>
      )}
      <p className="text-[11px] leading-4 text-ink-faint">Required — we&apos;ll verify it next. Private, never shown publicly.</p>
    </div>
  );
}
