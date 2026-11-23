import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { recordInsideAuditEvent } from "@/lib/inside/audit";
import { verifySameOrigin } from "@/lib/inside/origin";
import { insideMutationRateLimit } from "@/lib/inside/mutation-rate-limit";
import { SUSPENSION_REASON_MAX, validateSuspensionReason } from "@/lib/auth/suspension";
import {
  cleanSuspensionReason,
  moderationCompensationArgs,
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

  const { reportId, resolution, moderate, reason } = (await req.json().catch(() => ({}))) as {
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

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_resolve_report", {
    p_report_id: reportId,
    p_resolution: resolution,
  });
  if (error) {
    // Failed mutation: no success event is recorded.
    if (error.code === "42501") return NextResponse.json({ error: GENERIC }, { status: 403 });
    if (error.code === "02000") {
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not resolve the report." }, { status: 500 });
  }
  const row = data as {
    id: string;
    reported_id: string;
    previous_status: string;
    new_status: string;
    changed: boolean;
  };

  // No-op (already in the target state): no event. Moderation is skipped
  // too — there is nothing to attach it to on a no-op call.
  if (row.changed !== true) {
    return NextResponse.json({ ok: true, changed: false, status: row.new_status });
  }

  const resolveAudit = await recordInsideAuditEvent("REPORT_RESOLVED", {
    targetType: "report",
    targetId: row.id,
    metadata: {
      previous_status: row.previous_status,
      new_status: row.new_status,
      reported_id: row.reported_id,
      ...(cleanReason ? { reason: cleanReason } : {}),
    },
  });
  if (!resolveAudit.ok) {
    // Fail closed: restore the previous status. The sanctioned resolver
    // only moves toward terminal states, so compensation goes through the
    // server-only service-role client (never the browser).
    console.error("[inside] report resolve audit failed; restoring previous state");
    try {
      const service = createServiceRoleClient();
      await service.from("reports").update({ status: row.previous_status }).eq("id", row.id);
    } catch {}
    return NextResponse.json({ error: "Could not resolve the report." }, { status: 500 });
  }

  // Optional moderation of the reported student: an explicit second
  // mutation with its own audit event (same fail-closed contract).
  if (moderationMode === null) {
    return NextResponse.json({ ok: true, changed: true, status: row.new_status });
  }
  const wantActive = moderationMode === "restore";
  // Restore compensation may need to re-suspend, which requires a reason:
  // remember the current reason before the write clears it. The restore
  // itself must NOT reuse the report's reason text.
  let priorReason: string | null = null;
  if (wantActive) {
    try {
      const service = createServiceRoleClient();
      const { data: prior } = await service
        .from("profiles")
        .select("suspension_reason")
        .eq("user_id", row.reported_id)
        .maybeSingle();
      priorReason = cleanSuspensionReason(
        (prior as { suspension_reason?: unknown } | null)?.suspension_reason,
        SUSPENSION_REASON_MAX,
      );
    } catch {}
  }
  const { data: modData, error: modError } = await supabase.rpc("admin_set_student_active", {
    p_target_user_id: row.reported_id,
    p_active: wantActive,
    ...(cleanReason && !wantActive ? { p_reason: cleanReason } : {}),
  });
  if (modError) {
    if (modError.code === "22000") {
      return NextResponse.json(
        { error: "Tell the student why they're suspended." },
        { status: 400 },
      );
    }
    // The resolution above succeeded and is audited; only the moderation
    // half failed, so report honestly without inventing an audit event.
    return NextResponse.json(
      {
        ok: true,
        changed: true,
        status: row.new_status,
        moderation: { ok: false, error: "Could not update the reported student." },
      },
      { status: 200 },
    );
  }
  const mod = modData as { user_id: string; previous_active: boolean; new_active: boolean; changed: boolean };
  if (mod.changed === true) {
    const modAudit = await recordInsideAuditEvent(
      wantActive ? "STUDENT_RESTORED" : "STUDENT_SUSPENDED",
      {
        targetType: "student",
        targetId: mod.user_id,
        metadata: {
          previous_active: mod.previous_active,
          new_active: mod.new_active,
          report_id: row.id,
          ...(cleanReason ? { reason: cleanReason } : {}),
        },
      },
    );
    if (!modAudit.ok) {
      console.error("[inside] report moderation audit failed; restoring previous state");
      try {
        await supabase.rpc("admin_set_student_active", {
          p_target_user_id: mod.user_id,
          ...moderationCompensationArgs({
            previousActive: mod.previous_active,
            priorReason,
            suspendReason: wantActive ? null : cleanReason,
          }),
        });
      } catch {}
      return NextResponse.json({ error: "Could not update the reported student." }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    changed: true,
    status: row.new_status,
    moderation: { ok: true, changed: mod.changed === true, isActive: mod.new_active },
  });
}
