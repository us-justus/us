import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncVerifiedEmailFromUser } from "@/lib/auth/sync-verified-email";

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
  const result = await syncVerifiedEmailFromUser(user);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Could not synchronize account email." },
      { status: result.reason === "unverified" ? 400 : 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
