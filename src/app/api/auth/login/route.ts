import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeUSN, validateUSN } from "@/lib/verification/usn";
import { destinationForStep } from "@/lib/auth/redirect";
import { getOnboardingState } from "@/lib/onboarding/state";

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
 * No-email accounts fail here with the same generic message: without an
 * auth email there is no cross-device credential, by Supabase Auth design.
 * Those accounts stay signed in on their original device and can add an
 * email later in Settings to unlock sign-in elsewhere.
 */
const GENERIC = "Incorrect USN or password.";

export async function POST(req: Request) {
  const { usn, password } = await req.json().catch(() => ({}));
  const submitted = normalizeUSN(String(usn ?? ""));
  const pw = typeof password === "string" ? password : "";
  if (!validateUSN(submitted) || !pw || pw.length > 128) {
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  const supabase = await createClient();

  // Password-gated mapping: email string only on valid password, else NULL.
  // The RPC is the only place the auth email is touched; it is used below
  // for sign-in and never sent to the client.
  const { data: email, error: rpcError } = await supabase.rpc("resolve_login_email", {
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
  const { step } = await getOnboardingState(user);
  return NextResponse.json({ ok: true, next: destinationForStep(step) });
}
