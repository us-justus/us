import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeUSN, validateUSN } from "@/lib/verification/usn";
import {
  isInsideConfigured,
  mintInsideSession,
  setInsideCookieHeader,
  verifyAdminKey,
} from "@/lib/inside/auth";

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
 */
const GENERIC = "Those details don't open inside.";

export async function POST(req: Request) {
  const { identifier, password, adminKey } = await req.json().catch(() => ({}));

  const idRaw = typeof identifier === "string" ? identifier.trim() : "";
  const pw = typeof password === "string" ? password : "";
  if (!idRaw || !pw || pw.length > 128 || idRaw.length > 254) {
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  if (!isInsideConfigured()) {
    return NextResponse.json({ error: "Inside is unavailable right now." }, { status: 503 });
  }
  // Key checked up front so no auth work happens for a wrong key — still the
  // same generic message, so nothing about accounts is revealed either way.
  // The secret is never logged.
  if (!verifyAdminKey(adminKey)) {
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  const supabase = await createClient();
  let email: string | null = null;

  if (idRaw.includes("@")) {
    // Email identifier: Supabase verifies the password at sign-in.
    email = idRaw.toLowerCase();
  } else {
    const asUsn = normalizeUSN(idRaw);
    if (validateUSN(asUsn)) {
      // USN path reuses the product's password-gated resolver verbatim.
      const { data, error: rpcError } = await supabase.rpc("resolve_login_email", {
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
      const { data, error: rpcError } = await supabase.rpc("resolve_phone_login_email", {
        p_phone: idRaw,
        p_password: pw,
      });
      if (rpcError) {
        return NextResponse.json({ error: "Inside is unavailable right now." }, { status: 503 });
      }
      email = typeof data === "string" && data ? data : null;
    }
  }

  if (!email) return NextResponse.json({ error: GENERIC }, { status: 401 });

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: pw });
  if (signInError) return NextResponse.json({ error: GENERIC }, { status: 401 });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: GENERIC }, { status: 401 });

  // Explicit authorization: secret key alone is never sufficient.
  const { data: admin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError || admin !== true) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", setInsideCookieHeader(mintInsideSession(user.id)));
  return res;
}
