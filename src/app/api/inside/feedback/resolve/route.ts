import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { recordInsideAuditEvent } from "@/lib/inside/audit";
import { verifySameOrigin } from "@/lib/inside/origin";
import { insideMutationRateLimit } from "@/lib/inside/mutation-rate-limit";
import { readJsonBounded } from "@/lib/http/read-json-bounded";

/**
 * POST /api/inside/feedback/resolve — explicitly resolve feedback
 * (feedback Step 3).
 *
 * Body: { feedbackId: string }.
 *
 * Server-authorized: signed inside gate + admin_resolve_feedback()
 * SECURITY DEFINER (re-checks is_admin() in the database). A student
 * session invoking this — or the RPC directly — changes nothing (42501).
 *
 * Ordering is authenticate → authorize → mutate → audit → respond:
 *   - Failed mutations record nothing. No-op calls (already RESOLVED)
 *     record nothing.
 *   - Success records FEEDBACK_RESOLVED with target feedback +
 *     previous/new status.
 *   - FAIL CLOSED: audit failure restores OPEN via the server-only
 *     service-role client (the sanctioned resolver only moves toward
 *     RESOLVED) and returns 500, never silent success.
 *
 * Resolving sends NO email; replying never resolves.
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
  const { feedbackId } = parsed as { feedbackId?: unknown };
  if (typeof feedbackId !== "string" || !feedbackId.trim()) {
    return NextResponse.json({ error: "Pass a feedbackId." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("admin_resolve_feedback", {
    p_actor_id: gate.userId,
    p_feedback_id: feedbackId.trim(),
  });
  if (error) {
    // Failed mutation: no success event is recorded.
    if (error.code === "42501")
      return NextResponse.json({ error: GENERIC }, { status: 403 });
    if (error.code === "02000") {
      return NextResponse.json({ error: "Feedback not found." }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Could not resolve the feedback." },
      { status: 500 },
    );
  }
  const row = data as {
    id: string;
    previous_status: string;
    new_status: string;
    changed: boolean;
  };

  // No-op (already RESOLVED): no event.
  if (row.changed !== true) {
    return NextResponse.json({ ok: true, changed: false, status: row.new_status });
  }

  const audited = await recordInsideAuditEvent("FEEDBACK_RESOLVED", {
    targetType: "feedback",
    targetId: row.id,
    metadata: {
      previous_status: row.previous_status,
      new_status: row.new_status,
    },
  });
  if (!audited.ok) {
    // Fail closed: restore OPEN. The sanctioned resolver only moves
    // toward RESOLVED, so compensation goes through the server-only
    // service-role client (never the browser).
    console.error("[inside] feedback resolve audit failed; restoring previous state");
    try {
      const service = createServiceRoleClient();
      await service
        .from("feedback")
        .update({ status: row.previous_status, resolved_at: null, resolved_by: null })
        .eq("id", row.id);
    } catch {}
    return NextResponse.json(
      { error: "Could not resolve the feedback." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, changed: true, status: row.new_status });
}
