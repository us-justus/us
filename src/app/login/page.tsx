"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useExistingSession } from "@/lib/auth/use-existing-session";
import { validateAccountEmail } from "@/lib/auth/account";
import { isLaunchGatedPath, safeNextPath } from "@/lib/auth/safe-next";
import { normalizeUSN, validateUSN } from "@/lib/verification/usn";
import { FieldError } from "@/components/onboarding/shell";

/**
 * Sign-in with USN + password, bound to campus identity.
 *
 * Never calls ensureAnonymousSession — no anonymous user is minted here.
 * Email is optional across the product, so it is not the login identifier:
 * USN exists for every verified student.
 *
 * Flow: USN + password → POST /api/auth/login, which resolves the private
 * USN → auth-email mapping server-side (email never leaves the server),
 * authenticates with Supabase Auth (Supabase owns passwords; USN is never a
 * password and never authenticates alone), then verifies server-side that
 * the submitted USN belongs to the authenticated user. All credential
 * failures return one generic message so login never reveals whether a USN
 * exists. Destination comes from the server onboarding state: complete →
 * /discover, otherwise the onboarding step. An optional `/login?next=`
 * return URL is forwarded to the API, which validates it server-side and
 * honors it only where the existing guards already allow it.
 *
 * Email-skipped accounts that set a password hold a confirmed internal
 * sign-in identity (server-attached, never displayed) and sign in here with
 * the same USN + password. Legacy anonymous accounts with no password fail
 * here with the same generic message.
 */
const GENERIC = "Incorrect USN or password.";

function LoginFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, user } = useExistingSession();

  const [usn, setUsn] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [forgot, setForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  async function signIn() {
    setError(null);
    const normalizedUsn = normalizeUSN(usn);
    if (!validateUSN(normalizedUsn) || !password) {
      setError("Enter your USN and password.");
      return;
    }
    setBusy(true);
    try {
      // Fully server-side: the auth email (if any) never touches the client.
      // The server route sets the session cookies on success. The `next`
      // query value (if any) is forwarded for server-side validation — the
      // API honors it only where the existing guards already allow it.
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usn: normalizedUsn, password, next: searchParams.get("next") }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof j?.error === "string" ? j.error : GENERIC);
      // The destination route re-renders server-side with the fresh session
      // cookies, and the header re-resolves via its auth subscription — no
      // router.refresh() needed after the mutation.
      router.push(typeof j?.next === "string" ? j.next : "/onboarding");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : GENERIC);
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
    setResetErr(null);
    setResetSent(false);
    const err = validateAccountEmail(resetEmail);
    if (err) {
      setResetErr(err);
      return;
    }
    setResetBusy(true);
    try {
      const supabase = createClient();
      await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: `${window.location.origin}/auth/confirm?next=/auth/update-password`,
      });
      // Always show success — never reveal whether the email exists.
      // USN stays out of the reset mechanism: after recovery the account
      // still belongs to its verified USN, checked at next sign-in.
      setResetSent(true);
    } catch {
      setResetSent(true);
    } finally {
      setResetBusy(false);
    }
  }

  if (status === "initializing") {
    return <p className="mt-8 text-[13px] text-ink-soft">checking your session…</p>;
  }

  // Already signed in with a PERMANENT account: route by product state
  // (single server source). Anonymous sessions are onboarding identities, not
  // login states — an anonymous holder must still see the credential form,
  // since sign-in replaces the anonymous session with the permanent one.
  // Gating on `user` alone hid the form on every device that had ever
  // started onboarding (no password field rendered at all).
  const isAnonymous = (user as { is_anonymous?: boolean } | null)?.is_anonymous === true;
  if (status === "ready" && user && !isAnonymous) {
    return <SignedInContinue />;
  }

  return (
    <div className="mt-8">
      {status === "ready" && isAnonymous && (
        <p className="mb-5 rounded-2xl border border-line bg-paper-2 px-4 py-3 text-[13px] leading-5 text-ink-soft">
          This device holds a guest session. Signing in switches to your account.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void signIn();
        }}
      >
      <div>
        <label htmlFor="login-usn" className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">usn</label>
        <input
          id="login-usn"
          name="usn"
          type="text"
          value={usn}
          onChange={(e) => setUsn(e.target.value)}
          placeholder="e.g. 1AY22CS001"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username"
          enterKeyHint="next"
          className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base uppercase tracking-[0.08em] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft placeholder:normal-case placeholder:tracking-normal"
        />
      </div>
      {!forgot && (
        <div className="mt-4">
          <label htmlFor="login-password" className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">password</label>
          <div className="relative mt-2">
            <input
              id="login-password"
              name="password"
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="your password"
              autoComplete="current-password"
              enterKeyHint="go"
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
      )}

      {error && !forgot && (
        <div className="mt-4 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
          <p className="text-[13px] text-accent-deep">{error}</p>
        </div>
      )}

      {!forgot ? (
        <>
          <button
            type="submit"
            disabled={busy}
            className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {busy ? "signing in…" : "continue"}
          </button>
          <button
            type="button"
            onClick={() => {
              setForgot(true);
              setError(null);
            }}
            className="mt-4 min-h-[44px] w-full rounded-full py-2 text-[12px] tracking-[0.12em] uppercase text-ink-soft transition-colors hover:text-accent-deep hover:bg-accent-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            forgot password?
          </button>
        </>
      ) : (
        <div className="mt-5 rounded-[24px] border border-line bg-paper-2 px-5 py-6">
          <p className="font-display text-[20px] tracking-[-0.02em]">reset password.</p>
          <p className="mt-1 text-[13px] leading-6 text-ink-soft">
            Reset links go to your account email — only accounts with a real
            email can use this. Signed up without one and never set a
            password? Sign in on your original device and add an email in
            Settings first.
          </p>
          <div className="mt-4">
            <label htmlFor="login-reset-email" className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">account email</label>
            <input
              id="login-reset-email"
              name="reset-email"
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              placeholder="you@campus.edu"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="email"
              enterKeyHint="send"
              className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
            />
          </div>
          {resetErr && (
            <div className="mt-3">
              <FieldError msg={resetErr} />
            </div>
          )}
          {resetSent && (
            <div className="mt-3 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
              <p className="text-[13px] text-accent-deep">
                If an account exists for this email, a reset link is on its way.
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={sendReset}
            disabled={resetBusy}
            className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {resetBusy ? "sending…" : "send reset link"}
          </button>
          <button
            type="button"
            onClick={() => {
              setForgot(false);
              setResetSent(false);
              setResetErr(null);
            }}
            className="mt-3 min-h-[44px] w-full rounded-full py-2 text-[12px] tracking-[0.12em] uppercase text-ink-soft transition-colors hover:text-accent-deep hover:bg-accent-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            back to sign in
          </button>
        </div>
      )}
      </form>

      <p className="mt-6 text-center text-[11px] leading-4 text-ink-faint">
        New here?{" "}
        <Link href="/onboarding" className="underline underline-offset-4 text-ink-soft transition-colors hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-full">
          start fresh on this device
        </Link>
      </p>
    </div>
  );
}

/**
 * Permanent-account visitor on /login: forward once to the server-decided
 * destination (complete → /discover, otherwise the onboarding step). Renders
 * no credential form. Anonymous sessions never reach this component — they
 * see the form (see LoginFlow above).
 */
function SignedInContinue() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/account/state", { cache: "no-store" });
        const j = await res.json().catch(() => null);
        if (cancelled) return;
        let dest = typeof j?.next === "string" ? j.next : "/onboarding";
        // Already-signed-in branch honors `/login?next=` with the same rules
        // as the login API: complete accounts only, launch-gated
        // destinations only once launched. The destination page re-guards
        // server-side regardless, so authority stays server-side.
        const candidate = safeNextPath(searchParams.get("next"));
        if (
          candidate &&
          j?.onboardingStep === "complete" &&
          (j?.launched === true || !isLaunchGatedPath(candidate))
        ) {
          dest = candidate;
        }
        router.replace(dest);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  if (failed) {
    return (
      <div className="mt-8">
        <p className="text-[13px] leading-6 text-ink-soft max-w-[38ch]">
          You&apos;re already signed in. Continue to your campus.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/onboarding"
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            continue
          </Link>
        </div>
      </div>
    );
  }
  return <p className="mt-8 text-[13px] text-ink-soft">taking you to your campus…</p>;
}

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 sm:px-8 py-10 sm:py-14">
        <p className="flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          welcome back
        </p>
        <h1 className="mt-2 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none">
          sign in.
        </h1>
        <Suspense fallback={<p className="mt-8 text-[13px] text-ink-soft">loading…</p>}>
          <LoginFlow />
        </Suspense>
      </div>
    </div>
  );
}
