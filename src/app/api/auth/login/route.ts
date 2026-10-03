import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { normalizeUSN, validateUSN } from "@/lib/verification/usn";
import { destinationForStep } from "@/lib/auth/redirect";
import { getLaunchState } from "@/lib/auth/launch";
import { resolveLoginNext } from "@/lib/auth/safe-next";
import { getOnboardingState } from "@/lib/onboarding/state";
import {
  LOGIN_THROTTLED_MESSAGE,
  getClientIp,
  loginRateLimitKeys,
} from "@/lib/auth/login-rate-limit";

/**
 * USN + password login (STEP 3C: email is optional, so it is not the login
 * identifier — USN exists for every verified student).
 *
 * 1. Receives USN + password only. USN is normalized/validated with the
 *    existing isolated utility.
 * 2. Resolves the private USN -> auth-email mapping server-side via the
 *    `resolve_login_email` RPC, which returns the email ONLY when the
 *    password verifies (bcrypt inside the function) and NULL otherwise.
 *    The email NEVER leaves the server and is never returned to the client.
 * 3. Authenticates with Supabase Auth (passwords remain Supabase-owned; USN
 *    is never a password and never authenticates alone).
 * 4. Verifies server-side that the submitted USN belongs to the
 *    authenticated user (defense in depth against email drift between the
 *    RPC read and sign-in). Mismatch signs out and fails generically.
 *
 * Every credential failure yields the same generic message so login never
 * reveals whether a USN exists. (USN existence is already visible via the
 * onboarding duplicate-USN response, so nothing new leaks either way.)
 * Email-skipped accounts that set a password sign in here normally (their
 * server-attached internal identity resolves through the same RPC).
 * Legacy anonymous accounts with no password fail with the same generic
 * message; their recovery path is email-add-in-Settings while signed in on
 * the original device.
 *
 * Optional `next` (string) in the request body carries the `/login?next=`
 * return URL. It is validated server-side (internal allowlisted path only)
 * and honored only for onboarding-complete accounts heading somewhere the
 * existing product/launch guards already allow; otherwise the existing
 * destination is returned. Invalid values are treated as absent.
 *
 * Abuse protection (STEP 3): before credential resolution the route performs
 * a cheap DB-backed fixed-window rate-limit check over hashed per-IP and
 * per-(IP, normalized USN) buckets (see `login-rate-limit.ts` + migration
 * `20261006000001_login_abuse_protection`). Throttled callers get a generic
 * 429 without touching `resolve_login_email` or Supabase Auth, so throttling
 * never reveals whether a USN exists. Credential resolution itself runs
 * server-side through the service-role key (anon EXECUTE on the resolver was
 * revoked) — the key never leaves the server.
 */
const GENERIC = "Incorrect USN or password.";

export async function POST(req: Request) {
  const { usn, password, next: requestedNext } = await req.json().catch(() => ({}));
  const submitted = normalizeUSN(String(usn ?? ""));
  const pw = typeof password === "string" ? password : "";
  if (!validateUSN(submitted) || !pw || pw.length > 128) {
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  // Cheap pre-auth gate: hashed keys only (raw IP/USN never stored, password
  // never involved). Fail-open on limiter error — authentication below still
  // runs fully, so a limiter outage never means auth success.
  const { ipKey, ipUsnKey } = loginRateLimitKeys(getClientIp(req), submitted);
  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Sign-in is unavailable right now." }, { status: 503 });
  }
  try {
    const { data, error } = await service.rpc("check_login_rate_limit", {
      p_ip_key: ipKey,
      p_ip_usn_key: ipUsnKey,
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

  // Password-gated mapping: email string only on valid password, else NULL.
  // The RPC is the only place the auth email is touched; it is used below
  // for sign-in and never sent to the client. Invoked via the server-only
  // service-role client because anon EXECUTE was revoked (Part A).
  const { data: email, error: rpcError } = await service.rpc("resolve_login_email", {
    p_usn: submitted,
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
  if (!stored || stored !== submitted) {
    // Do not leave a half-authenticated session behind.
    await supabase.auth.signOut();
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  // Reuse the already-authenticated user — never a second getUser().
  // Launch state resolves alongside onboarding state (independent queries).
  const [{ step }, launch] = await Promise.all([getOnboardingState(user), getLaunchState()]);
  const fallback = destinationForStep(step);
  // Optional `?next=` return URL (forwarded by /login from its query string).
  // resolveLoginNext() keeps the guards authoritative: incomplete onboarding
  // and PRE_LAUNCH launch-gated destinations both fall back to the existing
  // destination. An invalid `next` is treated as absent — never an error.
  // Best-effort: a fully verified login clears the caller's targeted
  // bucket so own typos don't linger. Never fails the login.
  try {
    await service.rpc("clear_login_rate_limit", { p_ip_usn_key: ipUsnKey });
  } catch {}
  return NextResponse.json({
    ok: true,
    next: resolveLoginNext({ step, launched: launch.launched, requestedNext, fallback }),
  });
}
