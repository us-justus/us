import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/** Synchronize only the authenticated, Auth-confirmed address after link return.
 *
 * Reconciliation for Auth-confirmed / vr-email-empty rows (e.g. an address
 * linked via Settings on a UID whose verification_records.email was never
 * recorded): without this backfill getOnboardingState() keeps resolving the
 * `email` step for an account that already proved its address.
 *
 * Response contract (unchanged): `{ ok: true }` on success, generic
 * `{ error }` otherwise — database internals never reach the browser. The
 * client distinguishes the two via HTTP status. Server-side failures are
 * logged with the database error code ONLY (never identifiers, addresses,
 * or UIDs) so a failing service-role write cannot disappear silently.
 */
export async function POST() {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  const email = user?.email?.trim();
  if (!user || !email || !user.email_confirmed_at) {
    return NextResponse.json({ error: "Could not synchronize account email." }, { status: 400 });
  }
  try {
    const service = createServiceRoleClient();
    const { error } = await service.from("verification_records").upsert({
      user_id: user.id,
      email,
      email_skipped: false,
      email_verified_at: user.email_confirmed_at,
    }, { onConflict: "user_id" });
    if (error) {
      // Observable server-side only: code (e.g. 42501) without any identity.
      console.error("[account] sync-verified-email failed", error.code ?? "unknown");
      return NextResponse.json({ error: "Could not synchronize account email." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    console.error("[account] sync-verified-email failed", "unknown");
    return NextResponse.json({ error: "Could not synchronize account email." }, { status: 500 });
  }
}
