"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useExistingSession, type ExistingSessionStatus } from "@/lib/auth/use-existing-session";
import type { User } from "@supabase/supabase-js";
import { getAccountState, validateAccountEmail, validateNewPassword } from "@/lib/auth/account";
import { displayAccountEmail } from "@/lib/auth/internal-email";
import { FieldError } from "@/components/onboarding/shell";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { SignOutButton } from "@/components/settings/sign-out-button";

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
function AccountFlow({
  status,
  user,
  refresh,
}: {
  status: ExistingSessionStatus;
  user: User | null;
  refresh: () => Promise<void>;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Reconciliation observability: true when the post-verify sync of the
  // confirmed Auth email into verification_records failed. Rendered as a
  // retry notice — never silent, never blocking (verification itself
  // already succeeded; reloading retries since ?verified=1 persists).
  const [syncFailed, setSyncFailed] = useState(false);

  // Just-verified password step (first password for the converted account).
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [done, setDone] = useState(false);

  const account = getAccountState(user);
  const linkError = params.get("error");
  const justVerified = params.get("verified") === "1";

  // The server verifies the session and Auth confirmation before it updates
  // the private onboarding record; the browser never writes trusted email state.
  // Reconciliation is best-effort for navigation (verification itself already
  // succeeded) but never silent: a failed sync sets a visible retry notice
  // instead of disappearing, so a stale verification_records row cannot go
  // unnoticed. Reloading retries — ?verified=1 persists across reload.
  useEffect(() => {
    if (!justVerified || !account?.email) return;
    let cancelled = false;
    (async () => {
      let failed = false;
      try {
        if (cancelled) return;
        const res = await fetch("/api/account/sync-verified-email", { method: "POST" });
        failed = !res.ok;
      } catch {
        failed = true;
      }
      // Sync outcome fetched on mount — server truth, not derived render state.
      if (failed && !cancelled) setSyncFailed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [justVerified, account?.email]);

  // Signed-out routing only (no account-state fetch): the server
  // /settings/account guard already enforced public → /login and incomplete
  // → step path, and SiteChrome owns the ambient snapshot. The local session
  // going away (sign-out, back/forward cache) routes to /login; the
  // server-side guard remains authoritative on every navigation. Fresh
  // post-mutation reads (password set, verify-continue below) are
  // intentional and unchanged.
  useEffect(() => {
    if (status === "signed-out") {
      router.replace("/login");
    }
  }, [status, router]);

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
      const j = (await res.json().catch(() => null)) as { next?: unknown } | null;
      setDone(true);
      const next: unknown = j?.next;
      setTimeout(() => router.push(typeof next === "string" ? next : "/discover"), 900);
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
  // Internal sign-in identities are never displayed — displayEmail is null
  // for them, leaving the secured state without an email line.
  if (account.kind === "permanent-verified" && !justVerified) {
    const displayEmail = displayAccountEmail(account.email);
    return (
      <div className="mt-8 space-y-8">
        <section className="rounded-[24px] border border-line bg-paper-2 px-5 py-6">
          <p className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">account</p>
          <p className="mt-2 font-display text-[22px] tracking-[-0.02em]">secured.</p>
          {displayEmail && <p className="mt-2 text-[14px] text-ink break-all">{displayEmail}</p>}
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
        <div className="mt-8 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
          <p className="text-[13px] text-accent-deep">
            secured — same account, same profile. Taking you back…
          </p>
        </div>
      );
    }
    return (
      <div className="mt-8">
        <div className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
          <p className="text-[13px] text-accent-deep">Email verified — set a password to finish.</p>
        </div>
        {syncFailed && (
          <div className="mt-4">
            <FieldError msg="Verified, but we couldn't link your email record. Reload to retry — nothing is lost." />
          </div>
        )}
        <div className="mt-6">
          <p className="font-display text-[22px] tracking-[-0.02em]">set your password.</p>
          <p className="mt-2 text-[13px] leading-6 text-ink-soft max-w-[38ch]">
            You&apos;ll use this with {displayAccountEmail(account.email) ?? "your email"} to sign in from any device.
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
                className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
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
                className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
              />
            </div>
            {pwErr && <FieldError msg={pwErr} />}
            <button
              onClick={setFirstPassword}
              disabled={pwBusy}
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
          <div className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
            <p className="text-[13px] text-accent-deep">{notice}</p>
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
                const j = (await res.json().catch(() => null)) as {
                  account?: { emailConfirmed?: unknown } | null;
                  email?: unknown;
                } | null;
                await refresh();
                if (j?.account?.emailConfirmed) {
                  // Sync the private onboarding email record with the just
                  // verified Auth email (own row; best-effort hygiene).
                  try {
                    const supabase = createClient();
                    const rawEmail: unknown = j?.email;
                    const authedEmail =
                      typeof rawEmail === "string" ? rawEmail : null;
                    const { data: { user: u } } = await supabase.auth.getUser();
                    if (u && authedEmail) {
                      const full = await supabase
                        .from("verification_records")
                        .upsert({ user_id: u.id, email: authedEmail, email_skipped: false }, { onConflict: "user_id" });
                      if (full.error && /email_skipped/i.test(full.error.message)) {
                        await supabase
                          .from("verification_records")
                          .upsert({ user_id: u.id, email: authedEmail }, { onConflict: "user_id" });
                      }
                    }
                  } catch {
                    // Best-effort only.
                  }
                  router.replace("/settings/account?verified=1");
                } else {
                  setNotice("Not verified yet — open the link in your email, then continue.");
                }
              }}
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              i&apos;ve verified — continue
            </button>
            <button
              onClick={() => sendLink(pendingEmail)}
              disabled={busy}
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-line bg-paper px-8 py-[14px] text-[12px] tracking-[0.14em] uppercase font-medium text-ink-soft transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
                className="min-h-[44px] w-full rounded-full py-2 text-[12px] tracking-[0.12em] uppercase text-ink-soft transition-colors hover:text-accent-deep hover:bg-accent-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
        <div className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
          <p className="text-[13px] text-accent-deep">
            That verification link expired or was already used. Enter your email below to get a
            fresh one.
          </p>
        </div>
      )}
      <div className={linkError === "link-expired" ? "mt-6" : ""}>
        <p className="text-[13px] leading-6 text-ink-soft max-w-[38ch]">
          No email on this account yet. Add one to sign in from other devices
          and recover your password. Your profile, photos, and matches stay
          exactly as they are — same account, just secured.
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
            className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
          {emailErr && <FieldError msg={emailErr} />}
        </div>
        <button
          onClick={() => sendLink()}
          disabled={busy}
          className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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

export default function AccountClient() {
  // Single session subscription for this page — shared by the account flow
  // and the sign-out section below (never two independent hooks).
  const { status, user, refresh } = useExistingSession();
  return (
    <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 sm:px-8 py-8 sm:py-10">
        <Link
          href="/settings"
          className="inline-flex min-h-[44px] items-center gap-1 rounded-full text-[11px] tracking-[0.14em] uppercase text-ink-faint transition-colors hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ← back to settings
        </Link>
        <p className="mt-6 flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          account
        </p>
        <h1 className="mt-2 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none">
          secure it.
        </h1>
        <Suspense fallback={<p className="mt-8 text-[13px] text-ink-soft">loading…</p>}>
          <AccountFlow status={status} user={user} refresh={refresh} />
        </Suspense>
        <AccountSignOut status={status} user={user} />
      </div>
    </div>
  );
}

/**
 * Sign out for every signed-in complete session — email and no-email alike.
 * Never conditioned on email presence or verification: it only ends the
 * Supabase session (username, #spot, profile, photos, and onboarding state
 * are untouched server-side). Shown below the account flow so all branches
 * (secured, pending, anonymous) expose the same control.
 */
function AccountSignOut({ status, user }: { status: ExistingSessionStatus; user: User | null }) {
  if (status !== "ready" || !user) return null;
  const account = getAccountState(user);
  if (!account) return null;
  return (
    <section className="mt-8">
      <div className="h-px bg-line" />
      <div className="py-5">
        <SignOutButton />
        {account.kind === "anonymous" && (
          <p className="mt-3 text-[11px] leading-4 text-ink-faint">
            Signing out before securing your account may prevent returning to it.
          </p>
        )}
      </div>
      <div className="h-px bg-line" />
    </section>
  );
}
