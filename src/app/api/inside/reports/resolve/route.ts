import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { verifySameOrigin } from "@/lib/inside/origin";
import { readJsonBounded } from "@/lib/http/read-json-bounded";
import { insideMutationRateLimit } from "@/lib/inside/mutation-rate-limit";
import { SUSPENSION_REASON_MAX, validateSuspensionReason } from "@/lib/auth/suspension";
import {
  cleanSuspensionReason,
  parseReportModeration,
} from "@/lib/inside/report-moderation";

/**
 * POST /api/inside/reports/resolve — resolve a report, optionally with a
 * student moderation action (INSIDE Step 3).
 *
 * Body: {
 *   reportId: string,
 *   resolution: "resolved" | "dismissed",
 *   moderate?: "suspend" | "restore",   // applied to the reported student
 *   reason?: string                      // required for suspend, max 280
 * }.
 *
 * Server-authorized: signed inside gate + admin_resolve_report() /
 * admin_set_student_active() SECURITY DEFINER writers (both re-check
 * is_admin()). Student sessions change nothing. Ordering per mutation is
 * authenticate → authorize → mutate → audit → respond:
 *   - Failed/unauthorized mutations record nothing. No-op resolutions
 *     (already in the target state) record nothing.
 *   - Success records REPORT_RESOLVED (target: the report) and, when
 *     moderation is applied, STUDENT_SUSPENDED / STUDENT_RESTORED
 *     (target: the reported student) as separate explicit events.
 *   - FAIL CLOSED: if a mutation succeeds but its audit write fails, the
 *     route restores the pre-mutation state (report status via the
 *     server-only service-role client — the sanctioned resolver only moves
 *     toward terminal states — moderation via the sanctioned writer) and
 *     returns 500 instead of success. Restore compensation re-suspends
 *     with the PRE-restore reason.
 */
const GENERIC = "Not available.";

export async function POST(req: Request) {
  if (!verifySameOrigin(req).ok) {
    return NextResponse.json({ error: GENERIC }, { status: 403 });
  }
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });
  const rate = await insideMutationRateLimit(req, gate.userId);
  if (!rate.allowed) return NextResponse.json({ error: GENERIC }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds ?? 60) } });

  const parsed = await readJsonBounded<Record<string, unknown>>(req, 16_384);
  if (!parsed) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const { reportId, resolution, moderate, reason } = parsed as {
    reportId?: unknown;
    resolution?: unknown;
    moderate?: unknown;
    reason?: unknown;
  };
  if (typeof reportId !== "string" || !reportId) {
    return NextResponse.json({ error: "Pass a reportId." }, { status: 400 });
  }
  if (resolution !== "resolved" && resolution !== "dismissed") {
    return NextResponse.json(
      { error: 'Pass resolution as "resolved" or "dismissed".' },
      { status: 400 },
    );
  }
  const parsedModeration = parseReportModeration(moderate);
  if (!parsedModeration.ok) {
    return NextResponse.json({ error: parsedModeration.error }, { status: 400 });
  }
  const moderationMode = parsedModeration.mode;
  const cleanReason = cleanSuspensionReason(reason, SUSPENSION_REASON_MAX);
  if (moderationMode === "suspend") {
    const reasonError = validateSuspensionReason(reason);
    if (reasonError) {
      return NextResponse.json({ error: reasonError }, { status: 400 });
    }
  }

  // One SECURITY DEFINER RPC performs report resolution, optional moderation,
  // and both audit inserts in a single PostgreSQL transaction.
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("admin_resolve_report_with_moderation", {
    p_actor_id: gate.userId,
    p_report_id: reportId,
    p_resolution: resolution,
    p_moderation: moderationMode,
    p_reason: cleanReason,
  });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: GENERIC }, { status: 403 });
    if (error.code === "02000") return NextResponse.json({ error: "Report or student not found." }, { status: 404 });
    if (error.code === "22000") return NextResponse.json({ error: "Tell the student why they're suspended." }, { status: 400 });
    console.error("[inside] atomic report moderation transaction failed");
    return NextResponse.json({ error: "Could not resolve the report." }, { status: 500 });
  }

  const result = data as {
    ok: true;
    changed: boolean;
    status: string;
    moderation?: { ok: true; changed: boolean; isActive: boolean } | null;
  };
  return NextResponse.json({
    ok: true,
    changed: result.changed === true,
    status: result.status,
    ...(result.moderation ? { moderation: result.moderation } : {}),
  });
}
