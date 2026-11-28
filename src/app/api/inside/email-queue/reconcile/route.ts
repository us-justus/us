import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { verifySameOrigin } from "@/lib/inside/origin";
import { insideMutationRateLimit } from "@/lib/inside/mutation-rate-limit";
import { readJsonBounded } from "@/lib/http/read-json-bounded";
import { isStaleSending } from "@/lib/inside/email-queue-send-runner";

const GENERIC = "Not available.";

function classifyUncertainOutcome(value: unknown): string {
  const detail = typeof value === "string" ? value.toLowerCase() : "";
  if (detail.includes("timed out") || detail.includes("timeout")) return "Provider response timed out";
  if (detail.includes("network")) return "Network outcome could not be confirmed";
  return "Delivery outcome could not be confirmed";
}

export async function GET() {
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });

  const service = createServiceRoleClient();
  const { data, error } = await service
    .from("waitlist_email_queue")
    .select("id, status, attempts, updated_at, last_error")
    .eq("status", "SENDING")
    .order("updated_at", { ascending: true })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: "Could not load uncertain email sends." }, { status: 500 });
  }

  const rows = Array.isArray(data) ? data.filter((value) => {
    if (!value || typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    return row.status === "SENDING" && typeof row.updated_at === "string" &&
      isStaleSending({
        id: typeof row.id === "string" ? row.id : "",
        user_id: null,
        email: "",
        status: "SENDING",
        attempts: typeof row.attempts === "number" ? row.attempts : 0,
        next_attempt_at: null,
        updated_at: row.updated_at,
        last_error: typeof row.last_error === "string" ? row.last_error : null,
      }, Date.now());
  }) : [];
  return NextResponse.json({
    rows: rows.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const row = value as Record<string, unknown>;
      if (
        typeof row.id !== "string" ||
        typeof row.updated_at !== "string" ||
        typeof row.attempts !== "number"
      ) return [];
      return [{
        id: row.id,
        status: "SENDING" as const,
        attempts: row.attempts,
        updatedAt: row.updated_at,
        reason: classifyUncertainOutcome(row.last_error),
      }];
    }),
  });
}

export async function POST(req: Request) {
  if (!verifySameOrigin(req).ok) {
    return NextResponse.json({ error: GENERIC }, { status: 403 });
  }
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });
  const rate = await insideMutationRateLimit(req, gate.userId);
  if (!rate.allowed) {
    return NextResponse.json({ error: GENERIC }, {
      status: 429,
      headers: { "Retry-After": String(rate.retryAfterSeconds ?? 60) },
    });
  }

  const parsed = await readJsonBounded<Record<string, unknown>>(req, 4096);
  if (!parsed) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const { queueId, updatedAt, outcome } = parsed;
  if (
    typeof queueId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(queueId) ||
    typeof updatedAt !== "string" ||
    !Number.isFinite(Date.parse(updatedAt)) ||
    (outcome !== "sent" && outcome !== "not_sent")
  ) {
    return NextResponse.json({ error: "Choose a valid row and outcome." }, { status: 400 });
  }

  const service = createServiceRoleClient();
  const { data, error } = await service.rpc("admin_reconcile_waitlist_email_queue", {
    p_actor_id: gate.userId,
    p_queue_id: queueId,
    p_expected_updated_at: updatedAt,
    p_outcome: outcome,
  });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: GENERIC }, { status: 403 });
    if (error.code === "02000") return NextResponse.json({ error: "Queue row not found." }, { status: 404 });
    if (error.code === "40001") return NextResponse.json({ error: "This row changed. Refresh and review it again." }, { status: 409 });
    if (error.code === "22000") return NextResponse.json({ error: "This row is no longer eligible for reconciliation." }, { status: 409 });
    return NextResponse.json({ error: "Could not reconcile this email send." }, { status: 500 });
  }

  const result = data as { id: string; status: string; outcome: string; attempts: number };
  return NextResponse.json({
    ok: true,
    id: result.id,
    status: result.status,
    outcome: result.outcome,
    attempts: result.attempts,
  });
}
