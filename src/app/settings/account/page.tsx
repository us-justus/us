"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useExistingSession } from "@/lib/auth/use-existing-session";
import { getAccountState, validateAccountEmail, validateNewPassword } from "@/lib/auth/account";
import { FieldError } from "@/components/onboarding/shell";
import { ChangePasswordForm } from "@/components/settings/change-password-form";

/**
 * Anonymous → permanent conversion. Links an email identity to the CURRENT
 * authenticated anonymous user (never signUp, never a new user, never a new
 * profile), verifies it, then sets a password. The Supabase user ID — and all
 * profile/photo/like/match/message ownership — is preserved by construction.
 *
 * What is shown is derived from Supabase Auth user state (source of truth),
 * plus local state for the in-progress flow. Query params from /auth/confirm:
 *   ?verified=1     — email was just verified, show the password step
 *   ?error=link-expired — the verification link was invalid/expired
 */
function AccountFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const { status, user, refresh } = useExistingSession();

  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Just-verified password step (first password for the converted account).
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [done, setDone] = useState(false);

  const account = getAccountState(user);
  const linkError = params.get("error");
  const justVerified = params.get("verified") === "1";

  // Product guard (server /settings already redirects, this covers back/forward
  // cache and direct client navigation): logged-out → /login, incomplete
  // onboarding → its /onboarding/* step. Never renders account UI to visitors.
  useEffect(() => {
    if (status === "signed-out") {
      router.replace("/login");
      return;
    }
    if (status !== "ready" || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/account/state", { cache: "no-store" });
        const j = await res.json().catch(() => null);
        if (cancelled) return;
        if (!j?.signedIn) router.replace("/login");
        else if (j.onboardingStep !== "complete" && typeof j.next === "string") {
          router.replace(j.next);
        }
      } catch {
        // Leave the account UI in place if the guard check itself fails —
        // the server-side /settings guard remains authoritative.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, user, router]);

  async function sendLink(target?: string) {
    const value = (target ?? email).trim();
    const err = validateAccountEmail(value);
    if (err) {
      setEmailErr(err);
      return;
    }
    setEmailErr(null);
    setNotice(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/confirm?next=/settings/account`;
      const { error } = await supabase.auth.updateUser(
        { email: value },
        { emailRedirectTo: redirectTo },
      );
      if (error) {
        // Generic message — never reveal whether an email is taken.
        throw new Error("This email can't be used right now. Try another.");
      }
      setSentTo(value);
      setNotice(`Verification email sent to ${value}.`);
    } catch (e: unknown) {
      setEmailErr(e instanceof Error ? e.message : "Could not send verification email.");
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
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error("Could not set password. Please try again.");
      // Same session, same UID — resolve where to go next server-side.
      const res = await fetch("/api/account/state", { cache: "no-store" });
      const j = await res.json().catch(() => null);
      setDone(true);
      const next = typeof j?.next === "string" ? j.next : "/discover";
      setTimeout(() => router.push(next), 900);
    } catch (e: unknown) {
      setPwErr(e instanceof Error ? e.message : "Could not set password.");
    } finally {
      setPwBusy(false);
    }
  }

  if (status === "initializing") {
    return <p className="mt-8 text-[13px] text-ink-soft">preparing your account…</p>;
  }

  if (status === "signed-out" || !user || !account) {
    return (
      <div className="mt-8">
        <p className="text-[13px] leading-6 text-ink-soft max-w-[38ch]">
          You&apos;re signed out. Taking you to sign in…
        </p>
      </div>
    );
  }

  // Fully secured already (and not freshly verified): nothing to convert.
  if (account.kind === "permanent-verified" && !justVerified) {
    return (
      <div className="mt-8 space-y-8">
        <section className="rounded-[24px] border border-line bg-paper-2 px-5 py-6">
          <p className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">account</p>
          <p className="mt-2 font-display text-[22px] tracking-[-0.02em]">secured.</p>
          {account.email && <p className="mt-2 text-[14px] text-ink break-all">{account.email}</p>}
          <p className="mt-1 text-[12px] text-ink-soft">verified email · password sign-in enabled</p>
        </section>
        <ChangePasswordForm title="set a new password" />
      </div>
    );
  }

  // Freshly verified (or verified without a password yet): set the password.
  if (account.kind === "permanent-verified" && justVerified) {
    if (done) {
      return (
        <div className="mt-8 rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-[13px] text-green-800">
            secured — same account, same profile. Taking you back…
          </p>
        </div>
      );
    }
    return (
      <div className="mt-8">
        <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-[13px] text-green-800">Email verified — set a password to finish.</p>
        </div>
        <div className="mt-6">
          <p className="font-display text-[22px] tracking-[-0.02em]">set your password.</p>
          <p className="mt-2 text-[13px] leading-6 text-ink-soft max-w-[38ch]">
            You&apos;ll use this with {account.email ?? "your email"} to sign in from any device.
          </p>
          <div className="mt-5 space-y-4">
            <div>
              <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">
                password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="at least 8 characters"
                autoComplete="new-password"
                enterKeyHint="next"
                className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base outline-none focus:border-ink-faint placeholder:text-ink-faint"
              />
            </div>
            <div>
              <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">
                confirm password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="repeat it"
                autoComplete="new-password"
                enterKeyHint="go"
                className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base outline-none focus:border-ink-faint placeholder:text-ink-faint"
              />
            </div>
            {pwErr && <FieldError msg={pwErr} />}
            <button
              onClick={setFirstPassword}
              disabled={pwBusy}
              className="inline-flex w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors disabled:opacity-40"
            >
              {pwBusy ? "saving…" : "secure my account"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Verification pending for an already-linked (but unconfirmed) email.
  const pendingEmail = account.kind === "permanent-unverified" ? account.email : sentTo;
  if (pendingEmail) {
    return (
      <div className="mt-8">
        {notice && (
          <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-[13px] text-green-800">{notice}</p>
          </div>
        )}
        <div className={notice ? "mt-6" : ""}>
          <p className="font-display text-[22px] tracking-[-0.02em]">check your inbox.</p>
          <p className="mt-2 text-[13px] leading-6 text-ink-soft max-w-[38ch]">
            We sent a verification link to <span className="text-ink break-all">{pendingEmail}</span>.
            Open it on this device to continue.
          </p>
          <div className="mt-5 flex flex-col gap-3">
            <button
              onClick={async () => {
                // Re-check server-side (source of truth), then sync local session.
                const res = await fetch("/api/account/state", { cache: "no-store" });
                const j = await res.json().catch(() => null);
                await refresh();
                if (j?.account?.emailConfirmed) {
                  router.replace("/settings/account?verified=1");
                } else {
                  setNotice("Not verified yet — open the link in your email, then continue.");
                }
              }}
              className="inline-flex w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors"
            >
              i&apos;ve verified — continue
            </button>
            <button
              onClick={() => sendLink(pendingEmail)}
              disabled={busy}
              className="inline-flex w-full items-center justify-center rounded-full border border-line bg-paper px-8 py-[14px] text-[12px] tracking-[0.14em] uppercase font-medium text-ink-soft hover:bg-paper-2 transition-colors disabled:opacity-40"
            >
              {busy ? "sending…" : "resend email"}
            </button>
            {account.kind === "anonymous" && (
              <button
                onClick={() => {
                  setSentTo(null);
                  setEmail("");
                  setNotice(null);
                }}
                className="w-full py-2 text-[12px] tracking-[0.12em] uppercase text-ink-soft hover:text-ink"
              >
                use a different email
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Default: anonymous user entering their email for the first time.
  return (
    <div className="mt-8">
      {linkError === "link-expired" && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-[13px] text-[#a63d2f]">
            That verification link expired or was already used. Enter your email below to get a
            fresh one.
          </p>
        </div>
      )}
      <div className={linkError === "link-expired" ? "mt-6" : ""}>
        <p className="text-[13px] leading-6 text-ink-soft max-w-[38ch]">
          Add your email to this account. Your profile, photos, and matches stay exactly as they
          are — same account, just secured.
        </p>
        <div className="mt-5">
          <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@campus.edu"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="email"
            enterKeyHint="send"
            className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base outline-none focus:border-ink-faint placeholder:text-ink-faint"
          />
          {emailErr && <FieldError msg={emailErr} />}
        </div>
        <button
          onClick={() => sendLink()}
          disabled={busy}
          className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors disabled:opacity-40"
        >
          {busy ? "sending…" : "send verification email"}
        </button>
        <p className="mt-3 text-[11px] leading-4 text-ink-faint">
          This links the email to your current account — it never creates a new one.
        </p>
      </div>
    </div>
  );
}

export default function AccountPage() {
  return (
    <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 sm:px-8 py-8 sm:py-10">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-[11px] tracking-[0.14em] uppercase text-ink-faint hover:text-ink-soft transition-colors"
        >
          ← back to settings
        </Link>
        <p className="mt-6 text-[11px] tracking-[0.18em] uppercase text-ink-faint">account</p>
        <h1 className="mt-2 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none">
          secure it.
        </h1>
        <Suspense fallback={<p className="mt-8 text-[13px] text-ink-soft">loading…</p>}>
          <AccountFlow />
        </Suspense>
      </div>
    </div>
  );
}
