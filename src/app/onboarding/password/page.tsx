"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAnonymousSession } from "@/lib/auth/use-anonymous-session";
import { validateNewPassword } from "@/lib/auth/account";
import { Shell, FieldError } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";

type Phase =
  | "loading"
  | "link" // anonymous: link the recorded email to this user first
  | "pending" // verification email sent, waiting for inbox confirm
  | "password" // verified permanent identity: set the password
  | "done";

function PasswordFlow() {
  const router = useRouter();
  const { status: sessionStatus, retry: retrySession } = useAnonymousSession();

  const [phase, setPhase] = useState<Phase>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  /** Resolve where this user stands: recorded email + server account state. */
  const resolveState = useCallback(async (): Promise<{ vrEmail: string | null; kind: string | null; next: string | null; step: string | null }> => {
    const [emailRes, stateRes] = await Promise.all([
      fetch("/api/onboarding/email", { cache: "no-store" }),
      fetch("/api/account/state", { cache: "no-store" }),
    ]);
    const emailJ = await emailRes.json().catch(() => null);
    const stateJ = await stateRes.json().catch(() => null);
    return {
      vrEmail: (emailJ?.email as string | null) ?? null,
      kind: (stateJ?.account?.kind as string | null) ?? null,
      next: (typeof stateJ?.next === "string" ? stateJ.next : null) as string | null,
      step: (typeof stateJ?.onboardingStep === "string" ? stateJ.onboardingStep : null) as string | null,
    };
  }, []);

  useEffect(() => {
    if (sessionStatus !== "ready") return;
    let cancelled = false;
    (async () => {
      try {
        const { vrEmail, kind, next, step } = await resolveState();
        if (cancelled) return;
        // Already past this step (grandfathered campus user, or finished):
        // follow the single server routing source.
        if (step && step !== "password" && next) {
          router.replace(next);
          return;
        }
        setEmail(vrEmail);
        if (!vrEmail) {
          router.replace("/onboarding/email");
          return;
        }
        if (kind === "permanent-verified") setPhase("password");
        else if (kind === "permanent-unverified") setPhase("pending");
        else setPhase("link");
      } catch {
        if (!cancelled) setError("Could not load your account. Please try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, router, resolveState]);

  /** Link the recorded email to the CURRENT anonymous user (UID preserved). */
  async function sendLink(target: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/confirm?next=/onboarding/password`;
      const { error } = await supabase.auth.updateUser({ email: target }, { emailRedirectTo: redirectTo });
      if (error) throw new Error("This email can't be used right now. Try another.");
      setPhase("pending");
      setNotice(`Verification email sent to ${target}.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not send verification email.");
    } finally {
      setBusy(false);
    }
  }

  async function checkVerified() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { kind } = await resolveState();
      if (kind === "permanent-verified") {
        setPhase("password");
        setNotice("Email verified — set a password to finish.");
      } else {
        setNotice("Not verified yet — open the link in your email, then continue.");
      }
    } catch {
      setError("Could not check verification. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function setFirstPassword() {
    setPwErr(null);
    const pErr = validateNewPassword(password);
    if (pErr) {
      setPwErr(pErr);
      return;
    }
    if (password !== confirm) {
      setPwErr("Passwords don't match.");
      return;
    }
    setPwBusy(true);
    try {
      const supabase = createClient();
      // Same session, same UID — Supabase Auth stores the password hash.
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error("Could not set password. Please try again.");
      const { next } = await resolveState().catch(() => ({ next: "/onboarding/profile" as string | null }));
      setPhase("done");
      setTimeout(() => router.push(next ?? "/onboarding/profile"), 700);
    } catch (e: unknown) {
      setPwErr(e instanceof Error ? e.message : "Could not set password.");
    } finally {
      setPwBusy(false);
    }
  }

  if (sessionStatus === "initializing" || phase === "loading") {
    return <p className="text-[13px] text-ink-soft">preparing your account…</p>;
  }

  if (sessionStatus === "error") {
    return (
      <div className="space-y-3">
        <FieldError msg="We couldn't start your session. Please try again." />
        <Button onClick={retrySession} className="w-full rounded-full">
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {phase === "link" && email && (
        <>
          <p className="text-[13px] leading-6 text-ink-soft max-w-[38ch]">
            We&apos;ll secure <span className="text-ink break-all">{email}</span> on this account —
            same profile, same photos, just protected. First, verify it&apos;s yours.
          </p>
          {error && <FieldError msg={error} />}
          {notice && (
            <div className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
              <p className="text-[13px] leading-5 text-ink">{notice}</p>
            </div>
          )}
          <Button onClick={() => sendLink(email)} disabled={busy} className="w-full rounded-full">
            {busy ? "sending…" : "send verification email"}
          </Button>
          <p className="text-[11px] leading-4 text-ink-faint">
            This links the email to your current account — it never creates a new one.
          </p>
        </>
      )}

      {phase === "pending" && (
        <>
          <p className="font-display text-[22px] tracking-[-0.02em]">check your inbox.</p>
          <p className="text-[13px] leading-6 text-ink-soft max-w-[38ch]">
            We sent a verification link{email ? <> to <span className="text-ink break-all">{email}</span></> : null}.
            Open it on this device to continue.
          </p>
          {notice && (
            <div className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
              <p className="text-[13px] leading-5 text-ink">{notice}</p>
            </div>
          )}
          {error && <FieldError msg={error} />}
          <Button onClick={checkVerified} disabled={busy} className="w-full rounded-full">
            {busy ? "checking…" : "i've verified — continue"}
          </Button>
          {email && (
            <button
              onClick={() => sendLink(email)}
              disabled={busy}
              className="w-full py-2 text-[12px] tracking-[0.12em] uppercase text-ink-soft transition-colors hover:text-accent-deep hover:bg-accent-wash rounded-full min-h-[44px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              resend email
            </button>
          )}
        </>
      )}

      {(phase === "password" || phase === "done") && (
        <>
          {phase === "done" ? (
            <div className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
              <p className="text-[13px] leading-5 text-ink">secured — taking you to your profile…</p>
            </div>
          ) : (
            <>
              {notice && (
                <div className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
                  <p className="text-[13px] leading-5 text-ink">{notice}</p>
                </div>
              )}
              <div>
                <label htmlFor="onboarding-password" className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">password</label>
                <div className="relative mt-2">
                  <input
                    id="onboarding-password"
                    name="new-password"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="at least 8 characters"
                    autoComplete="new-password"
                    enterKeyHint="next"
                    className="w-full rounded-2xl border border-line bg-paper px-4 py-3.5 pr-16 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "hide password" : "show password"}
                    className="absolute right-2 top-1/2 flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-full text-[12px] tracking-[0.08em] uppercase text-ink-soft transition-colors hover:text-accent-deep hover:bg-accent-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {showPw ? "hide" : "show"}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="onboarding-confirm" className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">confirm password</label>
                <div className="relative mt-2">
                  <input
                    id="onboarding-confirm"
                    name="confirm-password"
                    type={showConfirm ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="repeat it"
                    autoComplete="new-password"
                    enterKeyHint="go"
                    className="w-full rounded-2xl border border-line bg-paper px-4 py-3.5 pr-16 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    aria-label={showConfirm ? "hide password" : "show password"}
                    className="absolute right-2 top-1/2 flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-full text-[12px] tracking-[0.08em] uppercase text-ink-soft transition-colors hover:text-accent-deep hover:bg-accent-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {showConfirm ? "hide" : "show"}
                  </button>
                </div>
              </div>
              {pwErr && <FieldError msg={pwErr} />}
              <Button onClick={setFirstPassword} disabled={pwBusy} className="w-full rounded-full">
                {pwBusy ? "saving…" : "secure my account"}
              </Button>
              <p className="text-[11px] leading-4 text-ink-faint">
                You&apos;ll use this{email ? <> with {email}</> : null} to sign back in from any device.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function PasswordPage() {
  return (
    <Shell title="set a password." subtitle="This — plus your email — is how you sign back in. Same account, same everything." step="03 — password">
      <Suspense fallback={<p className="text-[13px] text-ink-soft">loading…</p>}>
        <PasswordFlow />
      </Suspense>
    </Shell>
  );
}
