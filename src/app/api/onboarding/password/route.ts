import { NextResponse } from "next/server";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { perfLog, perfStart } from "@/lib/utils/perf";

/**
 * Legacy skipped-email password endpoint — DISABLED.
 *
 * EMAIL IS REQUIRED FOR EVERY ACCOUNT. This route previously attached a
 * confirmed internal email (`u-<uidhex>@us.signin.invalid`) plus a password
 * to anonymous users that skipped email. That path is removed: no new
 * skipped-email accounts are ever created here.
 *
 * - Always returns 410 Gone with an email-required message.
 * - Never touches Auth (no admin update, no internal identity, no password).
 * - Real-email accounts set their first password on the password step via
 *   the verified-email `updateUser()` flow (client → Supabase Auth), gated
 *   server-side by `getOnboardingState()` / `/api/account/state` requiring
 *   a real confirmed email.
 * - Legacy accounts already holding an internal identity keep working for
 *   sign-in (login resolver unchanged) but can no longer complete or
 *   re-complete onboarding through this route — they must supply + verify
 *   a real email via `/onboarding/email` → `/onboarding/password`.
 *
 * Server-only; the service-role key is no longer used here.
 */
export async function POST() {
  const t = perfStart();
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  perfLog("onboarding.password.skip-rejected", t);
  return NextResponse.json(
    {
      error: "An email is required — verify your email to continue.",
      emailRequired: true,
    },
    { status: 410 },
  );
}
