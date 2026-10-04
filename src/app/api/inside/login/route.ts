import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { normalizeUSN, validateUSN } from "@/lib/verification/usn";
import {
  isInsideConfigured,
  mintInsideSession,
  setInsideCookieHeader,
  verifyAdminKey,
} from "@/lib/inside/auth";
import {
  hashAdminLoginIdentity,
  recordInsideLoginFailure,
  recordInsideLoginSuccess,
} from "@/lib/inside/audit";
import { verifySameOrigin } from "@/lib/inside/origin";
import {
  LOGIN_THROTTLED_MESSAGE,
  adminLoginRateLimitKeys,
  getClientIp,
  normalizeAdminLoginIdentity,
} from "@/lib/auth/login-rate-limit";

/**
 * POST /api/inside/login — internal admin login (INSIDE v1).
 *
 * Body: { identifier, password, adminKey } where identifier is ANY ONE of
 * email / phone / USN. Uses the existing Supabase Auth architecture — no
 * separate auth system:
 *   - email identifier  → signInWithPassword directly (Supabase verifies).
 *   - USN identifier    → existing resolve_login_email RPC (password-gated
 *     USN -> email mapping), then signInWithPassword — same as /api/auth/login.
 *   - phone identifier  → new resolve_phone_login_email RPC (password-gated
 *     phone -> email mapping; phone auth exists nowhere else in the
 *     product, so this is the smallest new resolver), then signInWithPassword.
 *
 * After authentication: the session's user must be in admin_users
 * (is_admin() RPC). The submitted admin key must match ADMIN_SECRET_KEY
 * (server env only, timing-safe compare, never logged/returned). Success
 * mints a signed httpOnly cookie binding all three factors together.
 *
 * Every credential/authorization failure returns the same generic message so
 * the endpoint never reveals whether an identifier, account, or admin row
 * exists. The resolved auth email never leaves the server.
 *
 * Hardening (Step 1):
 *   - Origin-vs-Host check (`verifySameOrigin`) on this state-changing
 *     route; a foreign Origin fails with the SAME generic 401 so the
 *     rejection is indistinguishable from a bad credential.
 *   - DB-backed fixed-window rate limiting reusing the product login
 *     infrastructure (`check_login_rate_limit`, hashed `admin-ip:*`
 *     buckets, fail-open on limiter error, targeted-bucket reset on
 *     success). Throttled callers get the product's generic 429.
  *   - Missing ADMIN_SECRET_KEY / missing service-role configuration returns
  *     the SAME generic 401 as a bad credential (previously a distinct
  *     503 that oracled configuration state). Diagnostics stay server-side
  *     only and never include secrets or identifiers. Genuine downstream
  *     database outages keep the product-style 503 availability signal.
  *
  * Audit (Step 2):
  *   - Every generic 401 carrying an identifier records ADMIN_LOGIN_FAILURE
  *     (actor NULL — no session exists; attribution is a sha256 of the
  *     normalized identifier only). Malformed bodies without an identifier
  *     have nothing attributable and record nothing; 429 (limiter) and 503
  *     (availability) are not auth verdicts and record nothing.
  *   - A fully verified login records ADMIN_LOGIN_SUCCESS (actor = the
  *     session user id). Both writes are best-effort so an audit-storage
  *     outage can neither bypass auth nor leak credentials.
  */
const GENERIC = "Those details don't open inside.";

export async function POST(req: Request) {
  const { identifier, password, adminKey } = await req.json().catch(() => ({}));

  const idRaw = typeof identifier === "string" ? identifier.trim() : "";
  const pw = typeof password === "string" ? password : "";
  if (!idRaw || !pw || pw.length > 128 || idRaw.length > 254) {
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  // Audit attribution for failed attempts: hash-only digest of the
  // normalized identifier (same privacy approach as the login-abuse
  // buckets). Raw identifiers, passwords, keys, and tokens never reach the
  // audit log. Best-effort: an audit-storage outage must not change the
  // generic 401 outcome (see src/lib/inside/audit.ts).
  const identityHash = hashAdminLoginIdentity(idRaw);
  async function auditFailure(): Promise<void> {
    try {
      await recordInsideLoginFailure(identityHash);
    } catch {}
  }

  // CSRF layer only — indistinguishable failure; auth below stays authoritative.
  if (!verifySameOrigin(req).ok) {
    await auditFailure();
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  // Cheap pre-auth gate reusing the product limiter: hashed keys only (raw
  // IP/identifier never stored, password never involved). Fail-open on
  // limiter error — authentication below still runs fully, so a limiter
  // outage never means auth success.
  const { ipKey, ipIdKey } = adminLoginRateLimitKeys(
    getClientIp(req),
    normalizeAdminLoginIdentity(idRaw),
  );
  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    // Config class — externally identical to a bad credential; the cause
    // is only visible in server logs, without secrets or identifiers.
    console.error("[inside] login unavailable: service-role misconfigured");
    await auditFailure();
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }
  try {
    const { data, error } = await service.rpc("check_login_rate_limit", {
      p_ip_key: ipKey,
      p_ip_usn_key: ipIdKey,
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

  if (!isInsideConfigured()) {
    // Config class — externally identical to a bad credential (previously a
    // distinct 503 that revealed whether ADMIN_SECRET_KEY was configured).
    console.error("[inside] login unavailable: admin key misconfigured");
    await auditFailure();
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }
  // Key checked up front so no auth work happens for a wrong key — still the
  // same generic message, so nothing about accounts is revealed either way.
  // The secret is never logged.
  if (!verifyAdminKey(adminKey)) {
    await auditFailure();
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  // Credential resolution runs through the server-only service-role client:
  // anon EXECUTE on both resolvers was revoked (login abuse protection), so
  // the anon session client can no longer call them. The key never leaves
  // the server. Sign-in below stays on the session client (cookies); the
  // existing admin-key + is_admin() authorization is unchanged.
  const supabase = await createClient();
  let email: string | null = null;

  if (idRaw.includes("@")) {
    // Email identifier: Supabase verifies the password at sign-in.
    email = idRaw.toLowerCase();
  } else {
    const asUsn = normalizeUSN(idRaw);
    if (validateUSN(asUsn)) {
      // USN path reuses the product's password-gated resolver verbatim.
      const { data, error: rpcError } = await service.rpc("resolve_login_email", {
        p_usn: asUsn,
        p_password: pw,
      });
      if (rpcError) {
        return NextResponse.json({ error: "Inside is unavailable right now." }, { status: 503 });
      }
      email = typeof data === "string" && data ? data : null;
    } else {
      // Phone path: smallest new password-gated resolver (no phone auth
      // exists anywhere else in the product).
      const { data, error: rpcError } = await service.rpc("resolve_phone_login_email", {
        p_phone: idRaw,
        p_password: pw,
      });
      if (rpcError) {
        return NextResponse.json({ error: "Inside is unavailable right now." }, { status: 503 });
      }
      email = typeof data === "string" && data ? data : null;
    }
  }

  if (!email) {
    await auditFailure();
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: pw });
  if (signInError) {
    await auditFailure();
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    await auditFailure();
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  // Explicit authorization: secret key alone is never sufficient.
  const { data: admin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError || admin !== true) {
    await supabase.auth.signOut();
    await auditFailure();
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  // Best-effort: a fully verified login clears the caller's targeted bucket
  // so own typos don't linger. Never fails the login. (Same as product login.)
  try {
    await service.rpc("clear_login_rate_limit", { p_ip_usn_key: ipIdKey });
  } catch {}

  // Attribute the success to the just-verified admin (actor = server-side
  // session user, re-checked against admin_users inside the helper).
  // Best-effort: the session is already valid, so an audit-storage outage
  // must not revoke or fake the login — the failure is server-logged and
  // the login still succeeds (see src/lib/inside/audit.ts).
  try {
    await recordInsideLoginSuccess(user.id);
  } catch {}

  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", setInsideCookieHeader(mintInsideSession(user.id)));
  return res;
}
