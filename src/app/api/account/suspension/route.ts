import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * GET /api/account/suspension — the caller's own suspension state.
 *
 * Authenticated-only. Returns { suspended, reason, suspendedAt } for the
 * caller ONLY (identity from the session; no target parameter exists, so
 * no user can read another user's reason). This plus the login suspended
 * response are the only student-facing reason paths — the reason never
 * appears in /api/search, /u/[username], discover, invites, or the public
 * /api/account/state projection.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data, error } = await createServiceRoleClient()
    .from("profiles")
    .select("is_active, suspension_reason, suspended_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Could not load account status." }, { status: 500 });
  }
  const row = data as {
    is_active?: boolean | null;
    suspension_reason?: string | null;
    suspended_at?: string | null;
  } | null;
  if (row?.is_active === false) {
    return NextResponse.json({
      suspended: true as const,
      reason: typeof row.suspension_reason === "string" ? row.suspension_reason : null,
      suspendedAt: typeof row.suspended_at === "string" ? row.suspended_at : null,
    });
  }
  return NextResponse.json({ suspended: false as const, reason: null, suspendedAt: null });
}
