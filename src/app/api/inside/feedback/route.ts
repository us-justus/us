import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireInsideAdmin } from "@/lib/inside/auth";

/**
 * GET /api/inside/feedback — admin feedback inbox (feedback Step 3).
 *
 * Query: status ("open" [default] | "resolved" | "all"), limit (1–50),
 * offset. Server-authorized via requireInsideAdmin(); the
 * admin_list_feedback() SECURITY DEFINER function re-checks is_admin()
 * inside the database, so a student session calling it directly gets
 * 42501 and no data. Read-only: no audit event, no Origin check (reads
 * change nothing; POST mutations below carry the Origin layer).
 *
 * Rows carry student context for the reply workflow (username, nickname,
 * USN, trusted verification_records.email). The function never reads
 * auth.users, so no passwords, tokens, or auth internals can appear.
 */
const GENERIC = "Not available.";

export async function GET(req: Request) {
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });

  const url = new URL(req.url);
  const rawStatus = (url.searchParams.get("status") ?? "open").toLowerCase();
  const status =
    rawStatus === "resolved" || rawStatus === "all" ? rawStatus : "open";
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const offset = Number(url.searchParams.get("offset") ?? "0");

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("admin_list_feedback", {
    p_actor_id: gate.userId,
    p_status: status,
    p_limit: Number.isFinite(limit) ? Math.trunc(limit) : 20,
    p_offset: Number.isFinite(offset) ? Math.trunc(offset) : 0,
  });
  if (error) {
    if (error.code === "42501")
      return NextResponse.json({ error: GENERIC }, { status: 403 });
    return NextResponse.json(
      { error: "Could not load feedback." },
      { status: 500 },
    );
  }
  const row = data as { feedback: unknown[]; total: number } | null;
  return NextResponse.json({
    feedback: row?.feedback ?? [],
    total: row?.total ?? 0,
  });
}
