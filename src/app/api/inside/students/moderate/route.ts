import { NextResponse } from "next/server";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { verifySameOrigin } from "@/lib/inside/origin";
import { SUSPENSION_REASON_MAX, validateSuspensionReason } from "@/lib/auth/suspension";
import { insideMutationRateLimit } from "@/lib/inside/mutation-rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readJsonBounded } from "@/lib/http/read-json-bounded";

/**
 * POST /api/inside/students/moderate — suspend / restore a student
 * (INSIDE Step 3 + suspension-reason amendment).
 *
 * Body: { userId: string, action: "suspend" | "restore", reason?: string }.
 *
 * Suspend REQUIRES a non-blank reason (max 280 chars): the reason becomes
 * the student's CURRENT suspension state (profiles.suspension_reason,
 * visible to the suspended student + admins only) and is mirrored into
 * the STUDENT_SUSPENDED audit metadata. Restore clears the suspension
 * state; audit history is never deleted.
 *
 * Server-authorized: signed inside gate + service-role admin_set_student_active()
 * SECURITY DEFINER (re-checks is_admin() in the database). suspended_by /
 * suspended_at are server-derived (calling admin JWT / now()) — never
 * accepted from the client. A student session invoking this — or the RPC
 * directly — changes nothing (42501).
 * Suspension reuses profiles.is_active, which discover / search /
 * /u/[username] / invites already exclude; no new status field, no
 * unrelated field overloaded.
 *
 * Ordering is authenticate → authorize → validate → mutate → audit → respond:
 *   - Failed mutations record nothing. No-op calls (already suspended /
 *     already active) record nothing.
 *   - Success records STUDENT_SUSPENDED / STUDENT_RESTORED with target
 *     student + previous/new state (+ the reason on suspend).
 *   - FAIL CLOSED: audit failure restores the previous state via the same
 *     sanctioned writer and returns 500, never silent success.
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
  const { userId, action, reason } = parsed as {
    userId?: unknown;
    action?: unknown;
    reason?: unknown;
  };
  if (typeof userId !== "string" || !userId) {
    return NextResponse.json({ error: "Pass a student userId." }, { status: 400 });
  }
  if (action !== "suspend" && action !== "restore") {
    return NextResponse.json(
      { error: 'Pass action as "suspend" or "restore".' },
      { status: 400 },
    );
  }
  let cleanReason: string | null = null;
  if (action === "suspend") {
    const reasonError = validateSuspensionReason(reason);
    if (reasonError) {
      return NextResponse.json({ error: reasonError }, { status: 400 });
    }
    cleanReason = (reason as string).trim().slice(0, SUSPENSION_REASON_MAX);
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("admin_set_student_active_audited", {
    p_actor_id: gate.userId,
    p_target_user_id: userId,
    p_active: wantActive,
    p_reason: cleanReason,
  });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: GENERIC }, { status: 403 });
    if (error.code === "02000") return NextResponse.json({ error: "Student not found." }, { status: 404 });
    if (error.code === "22000") return NextResponse.json({ error: "Tell the student why they're suspended." }, { status: 400 });
    console.error("[inside] atomic student moderation transaction failed");
    return NextResponse.json({ error: "Could not update the student." }, { status: 500 });
  }

  const row = data as {
    user_id: string;
    previous_active: boolean;
    new_active: boolean;
    changed: boolean;
  };
  return NextResponse.json({
    ok: true,
    changed: row.changed === true,
    isActive: row.new_active,
  });
}
