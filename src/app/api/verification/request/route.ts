import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requestEmailVerification } from "@/lib/email-verification/worker";
import { perfLog, perfStart } from "@/lib/utils/perf";

/**
 * Staging email-ownership intake (vertical slice).
 *
 * POST { email }: binds the address to the CURRENT session user (same
 * auth.users.id — never signUp, never a new UID), resets trust when the
 * address changed, and queues delivery through the Brevo queue. Mints NO
 * token here — the send attempt mints its own (see worker.ts). The address
 * stays untrusted (email_verified_at NULL) until /auth/verify consumes a
 * delivered link. Explicit re-POST is the resend action (cooldown-guarded).
 */
export async function POST(req: Request) {
  const t = perfStart();
  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email : "";

  const session = await createClient();
  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Verification is unavailable right now." }, { status: 503 });
  }

  // Reuses the single auth.getUser() for this request — the worker derives
  // the user from the session, never from client input.
  const res = await requestEmailVerification(session, service, email);
  if (!res.ok) {
    const status = res.code === "unauthenticated" ? 401 : res.code === "cooldown" ? 429 : 400;
    const out = NextResponse.json({ error: res.error }, { status });
    if (typeof res.retryAfterSeconds === "number") {
      out.headers.set("Retry-After", String(res.retryAfterSeconds));
    }
    return out;
  }
  perfLog("verification.request", t);
  return NextResponse.json({ ok: true, deduplicated: res.deduplicated });
}
