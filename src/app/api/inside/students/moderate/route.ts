import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { recordInsideAuditEvent } from "@/lib/inside/audit";
import { verifySameOrigin } from "@/lib/inside/origin";

/**
 * POST /api/inside/students/moderate — suspend / restore a student
 * (INSIDE Step 3).
 *
 * Body: { userId: string, action: "suspend" | "restore", reason?: string }.
 *
 * Server-authorized: signed inside gate + admin_set_student_active()
 * SECURITY DEFINER (re-checks is_admin() in the database). A student
 * session invoking this — or the RPC directly — changes nothing (42501).
 * Suspension reuses profiles.is_active, which discover / search /
 * /u/[username] / invites already exclude; no new status field, no
 * unrelated field overloaded.
 *
 * Ordering is authenticate → authorize → mutate → audit → respond:
 *   - Failed mutations record nothing. No-op calls (already suspended /
 *     already active) record nothing.
 *   - Success records STUDENT_SUSPENDED / STUDENT_RESTORED with target
 *     student + previous/new state (+ short reason when supplied).
 *   - FAIL CLOSED: audit failure restores the previous state via the same
 *     sanctioned writer and returns 500, never silent success.
 */
const GENERIC = "Not available.";
const MAX_REASON = 280;

export async function POST(req: Request) {
  if (!verifySameOrigin(req).ok) {
    return NextResponse.json({ error: GENERIC }, { status: 403 });
  }
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });

  const { userId, action, reason } = await req.json().catch(() => ({}));
  if (typeof userId !== "string" || !userId) {
    return NextResponse.json({ error: "Pass a student userId." }, { status: 400 });
  }
  if (action !== "suspend" && action !== "restore") {
    return NextResponse.json(
      { error: 'Pass action as "suspend" or "restore".' },
      { status: 400 },
    );
  }
  const cleanReason =
    typeof reason === "string" && reason.trim() ? reason.trim().slice(0, MAX_REASON) : null;

  const supabase = await createClient();
  const wantActive = action === "restore";
  const { data, error } = await supabase.rpc("admin_set_student_active", {
    p_target_user_id: userId,
    p_active: wantActive,
  });
  if (error) {
    // Failed mutation: no success event is recorded.
    if (error.code === "42501") return NextResponse.json({ error: GENERIC }, { status: 403 });
    if (error.code === "02000") {
      return NextResponse.json({ error: "Student not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not update the student." }, { status: 500 });
  }
  const row = data as { user_id: string; previous_active: boolean; new_active: boolean; changed: boolean };

  // No-op (already in the target state): no event.
  if (row.changed !== true) {
    return NextResponse.json({ ok: true, changed: false, isActive: row.new_active });
  }

  const auditAction = wantActive ? "STUDENT_RESTORED" : "STUDENT_SUSPENDED";
  const audited = await recordInsideAuditEvent(auditAction, {
    targetType: "student",
    targetId: row.user_id,
    metadata: {
      previous_active: row.previous_active,
      new_active: row.new_active,
      ...(cleanReason ? { reason: cleanReason } : {}),
    },
  });

  if (!audited.ok) {
    // Fail closed: restore the previous state via the sanctioned writer.
    console.error("[inside] student moderation audit failed; restoring previous state");
    try {
      await supabase.rpc("admin_set_student_active", {
        p_target_user_id: userId,
        p_active: row.previous_active,
      });
    } catch {}
    return NextResponse.json({ error: "Could not update the student." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, changed: true, isActive: row.new_active });
}
