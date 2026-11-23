import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireInsideAdmin } from "@/lib/inside/auth";

/**
 * GET /api/inside/reports — admin moderation queue (INSIDE Step 3).
 *
 * Query: status (unresolved [default: pending + reviewed] | pending |
 * reviewed | resolved | dismissed | all), limit (1–50), offset.
 * Server-authorized via requireInsideAdmin(); admin_list_reports()
 * re-checks is_admin() in the database, so student sessions calling it
 * directly get 42501 and no data. Read-only: no audit event.
 *
 * Reuses public.reports (no duplicate table). Reporter/reported context
 * is public profile fields (username/nickname) only — never USN, email,
 * or auth internals.
 */
const GENERIC = "Not available.";
const REPORT_STATUSES = new Set(["unresolved", "pending", "reviewed", "resolved", "dismissed", "all"]);

export async function GET(req: Request) {
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "unresolved";
  if (!REPORT_STATUSES.has(status)) return NextResponse.json({ error: "Unsupported report status." }, { status: 400 });
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const offset = Number(url.searchParams.get("offset") ?? "0");

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("admin_list_reports", {
    p_actor_id: gate.userId,
    p_status: status,
    p_limit: Number.isFinite(limit) ? Math.trunc(limit) : 20,
    p_offset: Number.isFinite(offset) ? Math.trunc(offset) : 0,
  });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: GENERIC }, { status: 403 });
    return NextResponse.json({ error: "Could not load reports." }, { status: 500 });
  }
  const row = data as { reports: unknown[]; total: number } | null;
  return NextResponse.json({
    reports: row?.reports ?? [],
    total: row?.total ?? 0,
  });
}
