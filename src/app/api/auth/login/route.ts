import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { normalizeUSN } from "@/lib/verification/usn";
import { isInternalEmail } from "@/lib/auth/internal-email";
import { classifyLoginIdentifier } from "@/lib/auth/login-identifier";
import { destinationForStep } from "@/lib/auth/redirect";
import { resolveLoginNext } from "@/lib/auth/safe-next";
import { getOnboardingState } from "@/lib/onboarding/state";
import {
  LOGIN_THROTTLED_MESSAGE,
  getClientIp,
  loginRateLimitKeys,
  loginRateLimitKeysForEmail,
} from "@/lib/auth/login-rate-limit";

/**
 * USN-or-email + password login (SLICE 3: the identifier accepts either).
 *
 * Classification is server-side (`classifyLoginIdentifier`):
 *
 * 1. Valid USN → the existing USN path, preserved exactly:
 *    a. Resolves the private USN -> auth-email mapping server-side via the
 *       `resolve_login_email` RPC, which returns the email ONLY when the
 *       password verifies (bcrypt inside the function) and NULL otherwise.
 *       The email NEVER leaves the server and is never returned to the client.
 *    b. Authenticates with Supabase Auth (passwords remain Supabase-owned;
 *       USN is never a password and never authenticates alone).
 *    c. Verifies server-side that the submitted USN belongs to the
 *       authenticated user (defense in depth against email drift between the
 *       RPC read and sign-in). Mismatch signs out and fails generically.
 *    Email-skipped accounts that set a password sign in here normally (their
 *    server-attached internal identity resolves through the same RPC).
 *    Legacy anonymous accounts with no password fail with the same generic
 *    message; their recovery path is email-add-in-Settings while signed in
 *    on the original device.
 * 2. Valid (non-internal) email → the email path for first-year / no-USN
 *    accounts (and normal accounts that prefer their verified email):
 *    a. Authenticates directly with Supabase Auth `signInWithPassword`
 *       (Supabase verifies the password; no USN resolver involved, no USN
 *       required, no fake/internal USN synthesized).
 *    b. Verifies server-side that the authenticated email matches the
 *       submitted one (case-insensitive) and is not an internal identity.
 *       Mismatch signs out and fails generically.
 *
 * Every credential failure yields the same generic message so login never
 * reveals whether a USN or an email exists. (USN existence is already
 * visible via the onboarding duplicate-USN response, so nothing new leaks
 * either way.) No `signUp` anywhere on this route — first-year conversion
 * already happened during onboarding on the same UID.
 *
 * Optional `next` (string) in the request body carries the `/login?next=`
 * return URL. It is validated server-side (internal allowlisted path only)
 * and honored only for onboarding-complete accounts; otherwise the existing
 * destination is returned. Invalid values are treated as absent.
 *
 * Abuse protection (STEP 3, extended SLICE 3): before credential resolution
 * the route performs a cheap DB-backed fixed-window rate-limit check over
 * hashed per-IP and per-(IP, identifier) buckets (see
 * `login-rate-limit.ts` + migration `20261006000001_login_abuse_protection`).
 * USN identifiers bucket under `ip-usn:`, email identifiers under
 * `ip-email:` — same RPC, same limits, raw IP/identifier never stored,
 * password never involved. Throttled callers get a generic 429 without
 * touching `resolve_login_email` or Supabase Auth, so throttling never
 * reveals whether an identifier exists. Credential resolution itself runs
 * server-side through the service-role key (anon EXECUTE on the resolver was
 * revoked) — the key never leaves the server.
 */
const GENERIC = "Incorrect USN or password.";

export async function POST(req: Request) {
  const { identifier, usn, password, next: requestedNext } = (await req.json().catch(() => ({}))) as {
    identifier?: unknown;
    usn?: unknown;
    password?: unknown;
    next?: unknown;
  };
  // `identifier` is the current client field; legacy clients send `usn`.
  const rawIdentifier = typeof identifier === "string" ? identifier : typeof usn === "string" ? usn : "";
  const classified = classifyLoginIdentifier(rawIdentifier);
  const pw = typeof password === "string" ? password : "";
  if (classified.kind === "invalid" || !pw || pw.length > 128) {
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  // Cheap pre-auth gate: hashed keys only (raw IP/identifier never stored,
  // password never involved). Fail-open on limiter error — authentication
  // below still runs fully, so a limiter outage never means auth success.
  // The targeted bucket is per-(IP, USN) or per-(IP, email) depending on the
  // classified identifier; the RPC treats both as opaque text keys.
  const ip = getClientIp(req);
  const targetedKey =
    classified.kind === "usn"
      ? loginRateLimitKeys(ip, classified.usn).ipUsnKey
      : loginRateLimitKeysForEmail(ip, classified.email).ipEmailKey;
  const { ipKey } =
    classified.kind === "usn"
      ? loginRateLimitKeys(ip, classified.usn)
      : loginRateLimitKeysForEmail(ip, classified.email);
  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Sign-in is unavailable right now." }, { status: 503 });
  }
  try {
    const { data, error } = await service.rpc("check_login_rate_limit", {
      p_ip_key: ipKey,
      p_ip_usn_key: targetedKey,
    });
    if (!error) {
      const decision = data as { allowed?: boolean; retry_after_seconds?: number } | null;
      if (decision && decision.allowed === false) {
        const retry = Number(decision.retry_after_seconds ?? 0);
        const res = NextResponse.json({ error: LOGIN_THROTTLED_MESSAGE }, { status: 429 });
        // Include Retry-After only when reliably calculated by the function.
        if (Number.isFinite(retry) && retry > 0) res.headers.set("Retry-After", String(Math.ceil(retry)));
        return res;
      }
    }
  } catch {
    // Fail open for the limiter only; continue to real authentication.
  }

  const supabase = await createClient();

  if (classified.kind === "usn") {
    // Password-gated mapping: email string only on valid password, else NULL.
    // The RPC is the only place the auth email is touched; it is used below
    // for sign-in and never sent to the client. Invoked via the server-only
    // service-role client because anon EXECUTE was revoked (Part A).
    const { data: email, error: rpcError } = await service.rpc("resolve_login_email", {
      p_usn: classified.usn,
      p_password: pw,
    });
    if (rpcError) {
      return NextResponse.json({ error: "Sign-in is unavailable right now." }, { status: 503 });
    }
    if (typeof email !== "string" || !email) {
      return NextResponse.json({ error: GENERIC }, { status: 401 });
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: pw });
    // Generic — never reveal whether the email exists.
    if (signInError) return NextResponse.json({ error: GENERIC }, { status: 401 });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: GENERIC }, { status: 401 });

    const { data: vr } = await supabase
      .from("verification_records")
      .select("usn")
      .eq("user_id", user.id)
      .maybeSingle();

    const stored = vr?.usn ? normalizeUSN(String(vr.usn)) : "";
    if (!stored || stored !== classified.usn) {
      // Do not leave a half-authenticated session behind.
      await supabase.auth.signOut();
      return NextResponse.json({ error: GENERIC }, { status: 401 });
    }

    return respondWithDestination(service, supabase, user, targetedKey, requestedNext);
  }

  // Email path: Supabase Auth verifies the password directly. No USN
  // resolver, no USN required — first-year accounts (no USN) authenticate
  // here on the same permanent UID created during onboarding. Unknown email
  // and wrong password both surface as a sign-in error, hence the same
  // generic message with no enumeration.
  const { error: emailSignInError } = await supabase.auth.signInWithPassword({
    email: classified.email,
    password: pw,
  });
  // Generic — never reveal whether the email exists.
  if (emailSignInError) return NextResponse.json({ error: GENERIC }, { status: 401 });

  const { data: { user: emailUser } } = await supabase.auth.getUser();
  if (!emailUser) return NextResponse.json({ error: GENERIC }, { status: 401 });

  const authedEmail = (emailUser.email ?? "").trim().toLowerCase();
  if (!authedEmail || authedEmail !== classified.email || isInternalEmail(authedEmail)) {
    // Do not leave a half-authenticated session behind.
    await supabase.auth.signOut();
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  return respondWithDestination(service, supabase, emailUser, targetedKey, requestedNext);
}

/**
 * Shared post-authentication tail for both identifier paths: reuse the
 * already-authenticated user (never a second getUser()) and resolve the
 * existing onboarding state. Optional `?next=` return URL (forwarded by
 * /login from its query string): resolveLoginNext() keeps the guards
 * authoritative — incomplete onboarding falls back to the existing
 * destination. An invalid `next` is treated as absent — never an error.
 * Best-effort: a fully verified login clears the caller's targeted bucket
 * so own typos don't linger. Never fails the login.
 *
 * Suspension enforcement (Step 3 amendment): after identity verification,
 * the server reads profiles.is_active for the authenticated user. A
 * suspended account NEVER receives the normal login response — it gets a
 * dedicated 403 carrying its own suspension reason (visible only to that
 * user, never a generic "invalid credentials" after valid credentials).
 * The Supabase session is intentionally kept: the appeal/feedback path
 * requires authentication, and every product surface re-checks suspension
 * server-side (guardProductSession), so the session alone grants no
 * product access. No `next` is honored for suspended accounts.
 */
async function respondWithDestination(
  service: ReturnType<typeof createServiceRoleClient>,
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: Exclude<Parameters<typeof getOnboardingState>[0], null | undefined>,
  targetedKey: string,
  requestedNext: unknown,
) {
  // Reuse the already-authenticated user — never a second getUser().
  const { data: suspension } = await supabase
    .from("profiles")
    .select("is_active, suspension_reason")
    .eq("user_id", user.id)
    .maybeSingle();
  const state = suspension as { is_active?: boolean | null; suspension_reason?: string | null } | null;
  if (state?.is_active === false) {
    try {
      await service.rpc("clear_login_rate_limit", { p_ip_usn_key: targetedKey });
    } catch {}
    return NextResponse.json(
      {
        error: "This account is suspended.",
        suspended: true as const,
        reason: typeof state.suspension_reason === "string" ? state.suspension_reason : null,
      },
      { status: 403 },
    );
  }
  const [{ step }] = await Promise.all([getOnboardingState(user)]);
  const fallback = destinationForStep(step);
  try {
    await service.rpc("clear_login_rate_limit", { p_ip_usn_key: targetedKey });
  } catch {}
  return NextResponse.json({
    ok: true,
    next: resolveLoginNext({ step, requestedNext, fallback }),
  });
}
