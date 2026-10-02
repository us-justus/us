import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { toInternalEmail, isInternalEmail } from "@/lib/auth/internal-email";
import { validateNewPassword } from "@/lib/auth/account";
import { perfLog, perfStart } from "@/lib/utils/perf";

/**
 * Password conversion for email-skipped (anonymous) accounts.
 *
 * Attaches a confirmed internal email `u-<uidhex>@us.signin.invalid` plus the
 * supplied password to the CURRENT authenticated anonymous user, in place:
 * - UID comes exclusively from the authenticated session (never USN,
 *   username, or client input). No signUp, no new user, no profile/spot/
 *   photo migration — same auth.users.id by construction.
 * - Admin update with email_confirm: the account becomes non-anonymous and
 *   email-confirmed; no email is sent (.invalid never routes).
 * - Returns the internal sign-in email so the client can re-authenticate the
 *   SAME user with signInWithPassword() (fresh access/refresh session). The
 *   pre-conversion anonymous JWT is stale after the admin update and must
 *   not be reused — refreshSession() alone does not recover it.
 * - Idempotent: if the expected internal email is already attached, only the
 *   password is updated.
 * - Rejects accounts that already hold a real user email (those use the
 *   verified-email updateUser() flow, never this route).
 *
 * Server-only service-role key; never exposed to the client.
 */
export async function POST(req: Request) {
  const t = perfStart();
  const { password } = await req.json().catch(() => ({}));
  const pw = typeof password === "string" ? password : "";
  const pwErr = validateNewPassword(pw);
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });

  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // Real-email accounts must never pass through here.
  if (user.email && !isInternalEmail(user.email)) {
    return NextResponse.json(
      { error: "This account already has an email. Set the password after verification." },
      { status: 409 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[onboarding/password] missing service-role configuration");
    return NextResponse.json({ error: "Could not set password. Please try again." }, { status: 503 });
  }

  const expected = toInternalEmail(user.id);
  // Mismatched internal email on the same UID must never be silently kept.
  if (user.email && isInternalEmail(user.email) && user.email.toLowerCase() !== expected) {
    console.error("[onboarding/password] internal email mismatch");
    return NextResponse.json({ error: "Could not secure account. Please try again." }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    email: expected,
    password: pw,
    email_confirm: true,
  });
  if (error) {
    console.error("[onboarding/password] admin update failed", {
      code: (error as unknown as { code?: string }).code,
      message: error.message,
    });
    return NextResponse.json({ error: "Could not set password. Please try again." }, { status: 400 });
  }

  perfLog("onboarding.password.internal", t);
  return NextResponse.json({ ok: true, email: expected });
}
