import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInsideAdmin } from "@/lib/inside/auth";

/**
 * GET /api/inside/students — admin student listing (INSIDE dashboard).
 *
 * Query: q (username / nickname / USN / email / spot search), status
 * ("all" | "active" | "suspended", default "all"), limit (1–50), offset.
 * Server-authorized via requireInsideAdmin(); the
 * admin_list_students() SECURITY DEFINER function re-checks is_admin()
 * inside the database, so a student session calling it directly gets
 * 42501 and no data. Read-only: no audit event, no Origin check (reads
 * change nothing; POST mutations below carry the Origin layer).
 *
 * Returns only admin-useful fields (user_id, USN, email, profile display
 * fields, verification/onboarding state, timestamps, is_active). The
 * function never reads auth.users, so no passwords, tokens, or auth
 * internals can appear. Email shown here comes from
 * verification_records.email only.
 */
const GENERIC = "Not available.";

export async function GET(req: Request) {
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const rawStatus = (url.searchParams.get("status") ?? "all").toLowerCase();
  const status =
    rawStatus === "active" || rawStatus === "suspended" ? rawStatus : "all";
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const offset = Number(url.searchParams.get("offset") ?? "0");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_students", {
    p_search: q.slice(0, 100),
    p_limit: Number.isFinite(limit) ? Math.trunc(limit) : 20,
    p_offset: Number.isFinite(offset) ? Math.trunc(offset) : 0,
    p_status: status,
  });
  if (error) {
    return NextResponse.json({ error: "Could not load students." }, { status: 500 });
  }
  const row = data as { students: unknown[]; total: number } | null;
  return NextResponse.json({
    students: row?.students ?? [],
    total: row?.total ?? 0,
  });
}
