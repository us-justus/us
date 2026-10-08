"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useExistingSession } from "@/lib/auth/use-existing-session";
import {
  decideLoginEntry,
  showLoginGuestNotice,
  toLoginServerSnapshot,
  type LoginServerSnapshot,
} from "@/lib/auth/login-entry-decision";
import { validateAccountEmail } from "@/lib/auth/account";
import { safeNextPath } from "@/lib/auth/safe-next";
import { FieldError } from "@/components/onboarding/shell";

/**
 * Sign-in with USN-or-email + password, bound to campus identity.
 *
 * Never calls ensureAnonymousSession — no anonymous user is minted here.
 * The single identifier field accepts either a USN (normal student path) or
 * a verified account email (first-year / no-USN accounts, or normal accounts
 * that prefer their email). Classification happens server-side in
 * POST /api/auth/login: valid USNs take the existing password-gated
 * USN → auth-email mapping (email never leaves the server), valid emails
 * authenticate directly with Supabase Auth (Supabase owns passwords; the
 * identifier alone never authenticates). All credential failures return one
 * generic message so login never reveals whether a USN or an email exists.
 * Destination comes from the server onboarding state: complete → /home,
 * otherwise the onboarding step. An optional `/login?next=`
 * return URL is forwarded to the API, which validates it server-side and
 * honors it only where the existing guards already allow it.
 *
 * Email-skipped accounts that set a password hold a confirmed internal
 * sign-in identity (server-attached, never displayed) and sign in here with
 * the same USN + password. Legacy anonymous accounts with no password fail
 * here with the same generic message.
 */
const GENERIC = "Incorrect USN or password.";

/**
 * Raw `/api/account/state` payload shape as consumed by the login entry
 * gate and the resume branch. `account.kind` is the navigation authority:
 * only a server-confirmed non-anonymous kind may resume; anonymous (or
 * absent) kinds render the credential form. `signedIn: true` alone proves
 * nothing — the route intentionally reports it for anonymous onboarding
 * identities too.
 */
type AccountStatePayload = {
  signedIn?: unknown;
  account?: { kind?: unknown } | null;
  suspended?: unknown;
  next?: unknown;
  onboardingStep?: unknown;
};

function LoginFlow() {
  const searchParams = useSearchParams();
  const { status, user } = useExistingSession();

  // Server-authoritative entry resolution. The browser session alone cannot
  // decide this: an anonymous onboarding session must still see the form,
  // and the raw browser anonymity bit can disagree with the server
  // (stale/missing `is_anonymous` on a cached session user). So when a
  // browser user exists, the server kind is resolved once here; the resume
  // branch below reuses the same snapshot (no second fetch). Signed-out
  // devices skip the fetch entirely and render the form immediately.
  const [entry, setEntry] = useState<
    | { state: "checking" }
    | { state: "form"; guest: boolean; snapshot: LoginServerSnapshot | null }
    | { state: "continue"; preloaded: AccountStatePayload }
    | null
  >(null);

  useEffect(() => {
    if (status !== "ready" || !user) return;
    let cancelled = false;
    // Entry resolution is server truth fetched on mount, not derived render
    // state — disable cascading-render warning.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntry({ state: "checking" });
    (async () => {
      try {
        const res = await fetch("/api/account/state", { cache: "no-store" });
        const j = (await res.json().catch(() => null)) as AccountStatePayload | null;
        if (cancelled) return;
        const snapshot = toLoginServerSnapshot(res.ok, j);
        if (decideLoginEntry(snapshot) === "continue") {
          setEntry({ state: "continue", preloaded: (j ?? {}) as AccountStatePayload });
        } else {
          setEntry({ state: "form", guest: showLoginGuestNotice(snapshot), snapshot });
        }
      } catch {
        // Fail open: the credential form always works (sign-in re-authenticates
        // server-side), so a failed resolution must never block or redirect.
        if (!cancelled) setEntry({ state: "form", guest: false, snapshot: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, user]);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [forgot, setForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  // Fallback when the resume branch reports its own payload as not resumable
  // (navigation-site re-verification inside SignedInContinue): render the
  // credential form with no navigation. Stable identity so the resume effect
  // does not refire; the component unmounts on fallback, so this cannot loop.
  const handleNotResumable = useCallback((snapshot: LoginServerSnapshot | null) => {
    setEntry({ state: "form", guest: showLoginGuestNotice(snapshot), snapshot });
  }, []);

  async function signIn() {
    setError(null);
    // Identifier shape is classified server-side (USN vs email) — the client
    // only requires something typed plus a password.
    if (!identifier.trim() || !password) {
      setError("Enter your USN or email and password.");
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
        body: JSON.stringify({ identifier: identifier.trim(), password, next: searchParams.get("next") }),
      });
      const j = (await res.json().catch(() => null)) as {
        suspended?: unknown;
        error?: unknown;
        next?: unknown;
        onboardingStep?: unknown;
      } | null;
      if (!res.ok) {
        // Suspended accounts authenticate but are refused product access:
        // the session stays (appeals need auth) and the dedicated screen
        // explains why + links the appeal flow. Never a generic error here.
        if (j?.suspended === true) {
          window.location.assign("/suspended");
          return;
        }
        const errMsg: unknown = j?.error;
        throw new Error(typeof errMsg === "string" && errMsg ? errMsg : GENERIC);
      }
      // Full document navigation, not router.push: the server route sets the
      // session cookies, but the singleton browser client still holds the
      // pre-sign-in (often anonymous) session and server mutations do not
      // reliably fire onAuthStateChange. Reloading rehydrates the browser
      // client from the fresh cookies, so SERVER UID === BROWSER UID before
      // any onboarding mutation is allowed.
      const dest: unknown = j?.next;
      window.location.assign(typeof dest === "string" ? dest : "/onboarding");
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

  // A browser user exists but the server kind is still resolving: hold the
  // same loading copy. Never flash the form for permanent accounts, and
  // never flash the resume branch for anonymous ones.
  if (status === "ready" && user && (!entry || entry.state === "checking")) {
    return <p className="mt-8 text-[13px] text-ink-soft">checking your session…</p>;
  }

  // Resume navigation is permitted ONLY for a server-confirmed non-anonymous
  // account (resolved in the entry gate above from
  // GET /api/account/state → account.kind). Anonymous, absent, unknown, or
  // failed resolutions fall through to the credential form: signing in
  // replaces the anonymous session with the permanent one, so the form is
  // always safe to show and must never auto-navigate to onboarding.
  // If the resume branch ever reports its own payload as not resumable
  // (navigation-site re-verification inside SignedInContinue), fall back to
  // the form with no navigation — the component unmounts, so this cannot loop.
  if (status === "ready" && user && entry?.state === "continue") {
    return <SignedInContinue preloaded={entry.preloaded} onNotResumable={handleNotResumable} />;
  }
  const showGuestNotice =
    status === "ready" && !!user && entry?.state === "form" && entry.guest === true;

  return (
    <div className="mt-8">
      {showGuestNotice && (
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
        <label htmlFor="login-identifier" className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">usn or email</label>
        <input
          id="login-identifier"
          name="identifier"
          type="text"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="1AY22CS001 or you@campus.edu"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username"
          enterKeyHint="next"
          className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
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
          create a new account
        </Link>
      </p>
    </div>
  );
}

/**
 * Permanent-account visitor on /login: forward once to the server-decided
 * destination (complete → /home, otherwise the onboarding step). Renders
 * no credential form. Only mounted for a server-confirmed non-anonymous
 * account (see the LoginFlow entry gate above) — anonymous sessions,
 * absent sessions, and failed resolutions see the form instead, never this
 * component. Accepts the gate's already-fetched snapshot so the resume
 * branch performs exactly one /api/account/state request per login entry.
 *
 * Navigation-site re-verification: the mount gate alone is not trusted here.
 * Before ANY router.replace, this component re-projects the exact payload it
 * is about to navigate from through toLoginServerSnapshot()/decideLoginEntry()
 * and refuses to navigate for an anonymous, absent, or unknown account kind —
 * it reports back via onNotResumable so LoginFlow renders the credential form
 * instead. There is therefore no code path capable of router.replace()ing an
 * anonymous holder to /onboarding/email from this page, even if this
 * component ever mounts with a stale or mismatched snapshot.
 */
function SignedInContinue({
  preloaded,
  onNotResumable,
}: {
  preloaded?: AccountStatePayload | null;
  onNotResumable: (snapshot: LoginServerSnapshot | null) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let j: AccountStatePayload | null = preloaded ?? null;
        // Whether the navigated-from payload came from a verified HTTP
        // response. The gate only mounts this branch after a res.ok payload
        // decided "continue", so a passed-through body counts as verified;
        // the refetch path records its own status below.
        let ok = j !== null;
        if (!j) {
          const res = await fetch("/api/account/state", { cache: "no-store" });
          ok = res.ok;
          j = (await res.json().catch(() => null)) as AccountStatePayload | null;
        }
        if (cancelled) return;
        // Suspended sessions never continue into the product: the dedicated
        // screen explains why and links the appeal flow.
        if (j?.suspended === true) {
          router.replace("/suspended");
          return;
        }
        // Independent kind re-check at the navigation site: anonymous, absent,
        // unknown, or failed resolutions must never router.replace() — not to
        // /onboarding/email, not anywhere. Fall back to the credential form.
        const snapshot = toLoginServerSnapshot(ok, j);
        if (decideLoginEntry(snapshot) !== "continue") {
          onNotResumable(snapshot);
          return;
        }
        const accountNext: unknown = j?.next;
        let dest = typeof accountNext === "string" ? accountNext : "/onboarding";
        // Already-signed-in branch honors `/login?next=` with the same rules
        // as the login API: complete accounts only. The destination page
        // re-guards server-side regardless, so authority stays server-side.
        const candidate = safeNextPath(searchParams.get("next"));
        if (candidate && j?.onboardingStep === "complete") {
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
  }, [router, searchParams, preloaded, onNotResumable]);

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
