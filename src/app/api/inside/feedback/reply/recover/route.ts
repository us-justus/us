import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { recordInsideAuditEvent } from "@/lib/inside/audit";
import { verifySameOrigin } from "@/lib/inside/origin";
import { insideMutationRateLimit } from "@/lib/inside/mutation-rate-limit";
import { readJsonBounded } from "@/lib/http/read-json-bounded";

/**
 * POST /api/inside/feedback/reply/recover — explicit recovery for a reply
 * whose provider outcome was never recorded (F-12).
 *
 * Body: { feedbackId: string, outcome: "sent" | "not_sent" }.
 *
 * This route NEVER calls Brevo. `sent` records the reply body already
 * stored on the claim (after the admin verified delivery) and marks it
 * SENT. `not_sent` releases the claim so a normal reply retry is allowed.
 * The claim table is server-only; no provider id/recipient/actor is
 * accepted from the client.
 */
const GENERIC = "Not available.";

export async function GET(req: Request) {
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });
  const feedbackId = new URL(req.url).searchParams.get("feedbackId");
  if (!feedbackId?.trim()) return NextResponse.json({ error: "Pass a feedbackId." }, { status: 400 });
  let service: ReturnType<typeof createServiceRoleClient>;
  try { service = createServiceRoleClient(); }
  catch { return NextResponse.json({ error: "Could not load reply attempt." }, { status: 500 }); }
  const { data, error } = await service.from("feedback_reply_attempts")
    .select("state, claimed_at, settled_at").eq("feedback_id", feedbackId.trim()).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load reply attempt." }, { status: 500 });
  return NextResponse.json({ attempt: data ? { state: data.state, claimedAt: data.claimed_at, settledAt: data.settled_at } : null });
}

export async function POST(req: Request) {
  if (!verifySameOrigin(req).ok) {
    return NextResponse.json({ error: GENERIC }, { status: 403 });
  }
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });
  const rate = await insideMutationRateLimit(req, gate.userId);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: GENERIC },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds ?? 60) } },
    );
  }

  const parsed = await readJsonBounded<Record<string, unknown>>(req, 16_384);
  if (!parsed) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const { feedbackId, outcome } = parsed as {
    feedbackId?: unknown;
    outcome?: unknown;
  };
  if (typeof feedbackId !== "string" || !feedbackId.trim()) {
    return NextResponse.json({ error: "Pass a feedbackId." }, { status: 400 });
  }
  if (outcome !== "sent" && outcome !== "not_sent") {
    return NextResponse.json(
      { error: 'Pass outcome as "sent" or "not_sent".' },
      { status: 400 },
    );
  }

  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Could not recover the reply." }, { status: 500 });
  }

  const { data, error } = await service.rpc("admin_recover_feedback_reply", {
    p_feedback_id: feedbackId.trim(),
    p_outcome: outcome,
    p_actor_id: gate.userId,
  });
  if (error) {
    if (error.code === "02000") {
      return NextResponse.json({ error: "Reply attempt not found." }, { status: 404 });
    }
    if (error.code === "42501") {
      return NextResponse.json({ error: GENERIC }, { status: 403 });
    }
    return NextResponse.json({ error: "Could not recover the reply." }, { status: 500 });
  }
  const result = data as { ok?: unknown; state?: unknown; changed?: unknown } | null;
  if (result?.ok !== true) {
    return NextResponse.json({ error: "Could not recover the reply." }, { status: 500 });
  }

  if (outcome === "sent" && result.changed === true) {
    const { data: fb } = await service
      .from("feedback")
      .select("id, category")
      .eq("id", feedbackId.trim())
      .maybeSingle();
    const audited = await recordInsideAuditEvent("FEEDBACK_REPLIED", {
      targetType: "feedback",
      targetId: feedbackId.trim(),
      metadata: {
        ...(typeof (fb as { category?: unknown } | null)?.category === "string"
          ? { category: (fb as { category: string }).category }
          : {}),
        recovered: true,
      },
    });
    if (!audited.ok) {
      console.error("[inside] feedback reply recovery audit failed");
    }
  }

  return NextResponse.json({
    ok: true,
    state: result.state,
    changed: result.changed === true,
  });
}
