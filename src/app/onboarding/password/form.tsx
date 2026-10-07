"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAnonymousSession } from "@/lib/auth/use-anonymous-session";
import { validateNewPassword } from "@/lib/auth/account";
import { buildEmailEditHref, mapEmailLinkError } from "@/lib/onboarding/email-edit";
import { FieldError } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";

type Phase =
  | "loading"
  | "link" // anonymous: link the recorded email to this user first
  | "pending" // verification email sent, waiting for inbox confirm
  | "password" // verified permanent identity: set the password
  | "done";

/**
 * Quiet display form of the recorded email. The full address is only ever
 * used for Auth calls (`sendLink`); what renders on screen stays partial,
 * e.g. `atharva••••@icloud.com`. No existing masking utility — local helper.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? 1 : Math.min(7, Math.ceil(local.length / 2));
  return `${local.slice(0, visible)}••••@${domain}`;
}

export function PasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Query params set by /auth/confirm after exchanging the verification
  // link (same UID, same session — never a new account):
  //   ?verified=1       — link exchanged, re-resolve authoritative state below
  //   ?error=link-expired — link invalid/used, offer a resend (never a bypass)
  const justVerified = params.get("verified") === "1";
  const linkError = params.get("error");
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
    const emailJ = (await emailRes.json().catch(() => null)) as { email?: unknown } | null;
    const stateJ = (await stateRes.json().catch(() => null)) as {
      account?: { kind?: unknown } | null;
      next?: unknown;
      onboardingStep?: unknown;
    } | null;
    const vrEmail: unknown = emailJ?.email;
    const accountKind: unknown = stateJ?.account?.kind;
    const next: unknown = stateJ?.next;
    const step: unknown = stateJ?.onboardingStep;
    return {
      vrEmail: typeof vrEmail === "string" ? vrEmail : null,
      kind: typeof accountKind === "string" ? accountKind : null,
      next: typeof next === "string" ? next : null,
      step: typeof step === "string" ? step : null,
    };
  }, []);

  useEffect(() => {
    if (sessionStatus !== "ready") return;
    let cancelled = false;
    (async () => {
      try {
        const { vrEmail, kind, next, step } = await resolveState();
        if (cancelled) return;
        // Already past (or before) this step: follow the single server
        // routing source. The server requires a real verified email before
        // profile/photos/complete, so this also bounces unverified users
        // back to email when they open this URL directly.
        if (step && step !== "password" && next) {
          router.replace(next);
          return;
        }
        setEmail(vrEmail);
        if (!vrEmail) {
          // Email is REQUIRED on every track — no recorded email means back
          // to the email step (covers legacy skipped rows too).
          router.replace("/onboarding/email");
          return;
        }
        if (linkError === "link-expired") {
          // The verification link was invalid or already used. Stay in the
          // pending state with a resend affordance — never advance on the
          // param alone; only the server check below unlocks the password.
          setPhase("pending");
          setError("That verification link expired or was already used. Send a fresh one below.");
          return;
        }
        if (kind === "permanent-verified") {
          setPhase("password");
          if (justVerified) setNotice("Email verified — set a password to finish.");
        }
        else if (kind === "permanent-unverified") setPhase("pending");
        else setPhase("link");
      } catch {
        if (!cancelled) setError("Could not load your account. Please try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, router, resolveState, justVerified, linkError]);

  /** Link the recorded email to the CURRENT anonymous user (UID preserved). */
  async function sendLink(target: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/confirm?next=/onboarding/password`;
      const { error } = await supabase.auth.updateUser({ email: target }, { emailRedirectTo: redirectTo });
      if (error) throw new Error(mapEmailLinkError());
      setPhase("pending");
      setNotice(`Verification email sent to ${maskEmail(target)}. Open it, then continue.`);
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
      // Authoritative state only: the server derives this from Supabase
      // Auth's actual email-confirmation state for the current user. Clicking
      // this button is never itself proof of verification.
      const { kind } = await resolveState();
      if (kind === "permanent-verified") {
        // Sync the browser session to the just-verified identity (same UID —
        // read-only, never signUp, never a new user) so the password write
        // below runs as the converted account.
        try {
          const supabase = createClient();
          await supabase.auth.getUser();
        } catch {
          // Best-effort: the server check above already passed.
        }
        setPhase("password");
        setNotice("Email verified — set a password to finish.");
      } else {
        // Relevant state only: this renders only after a failed "I've
        // verified" check — never as permanent explanatory content.
        setError("Not verified yet — open the link, then continue.");
      }
    } catch {
      setError("Could not check verification. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function setFirstPassword() {
    if (pwBusy) return;
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
      // Server-owned password-setup proof: record password_set_at ONLY after
      // the Auth password write succeeds. The RPC takes no password and no
      // user_id (caller derived from auth.uid()); a failed password write
      // never reaches this call, so no proof is recorded on failure.
      const { error: recordError } = await supabase.rpc("record_onboarding_password");
      if (recordError) throw new Error("Could not set password. Please try again.");
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
            We sent a verification link to <span className="text-ink break-all">{maskEmail(email)}</span>.
          </p>
          <p className="text-[13px] leading-6 text-ink-soft">open it, then continue.</p>
          {error && <FieldError msg={error} />}
          {notice && (
            <div className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
              <p className="text-[13px] leading-5 text-ink">{notice}</p>
            </div>
          )}
          <Button onClick={() => sendLink(email)} disabled={busy} className="w-full rounded-full">
            {busy ? "sending…" : "send verification email"}
          </Button>
          {/*
            First-year recovery: a duplicate/rejected address fails the link
            above with a clear error but leaves the recorded email in place.
            This quiet secondary action returns to the editable email entry
            (`?edit=1`) to replace it — same UID, verification + password
            still required. Shown only in the unverified link phase by
            construction (verified phases render below instead).
          */}
          <button
            type="button"
            onClick={() => router.push(buildEmailEditHref())}
            className="w-full py-2 text-[12px] tracking-[0.12em] uppercase text-ink-soft transition-colors hover:text-accent-deep hover:bg-accent-wash rounded-full min-h-[44px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            use a different email
          </button>
        </>
      )}

      {phase === "pending" && (
        <>
          {email && (
            <p className="text-[15px] tracking-[0.02em] text-ink break-all">
              {maskEmail(email)}
            </p>
          )}
          <p className="text-[13px] leading-6 text-ink-soft">open it, then continue.</p>
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
          {/*
            Same recovery in the pending phase: the verification email may
            never arrive for a rejected address — replacing it is the only
            way forward. Unverified phase only; verified password entry below
            intentionally offers no email change (no verification bypass).
          */}
          <button
            type="button"
            onClick={() => router.push(buildEmailEditHref())}
            className="w-full py-2 text-[12px] tracking-[0.12em] uppercase text-ink-soft transition-colors hover:text-accent-deep hover:bg-accent-wash rounded-full min-h-[44px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            use a different email
          </button>
        </>
      )}

      {(phase === "password" || phase === "done") && (
        <>
          {phase === "done" ? (
            <div className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
              <p className="text-[13px] leading-5 text-ink">secured — taking you to your profile…</p>
            </div>
          ) : (
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                void setFirstPassword();
              }}
            >
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
                    className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 pr-16 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
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
              <Button type="submit" disabled={pwBusy} className="w-full rounded-full">
                {pwBusy ? "saving…" : "secure my account"}
              </Button>
              <p className="text-[11px] leading-4 text-ink-faint">
                You&apos;ll use this{email ? <> with {maskEmail(email)}</> : null} to sign back in from any device.
              </p>
            </form>
          )}
        </>
      )}
    </div>
  );
}
