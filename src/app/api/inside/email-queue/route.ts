import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { verifySameOrigin } from "@/lib/inside/origin";
import { insideMutationRateLimit } from "@/lib/inside/mutation-rate-limit";

const GENERIC = "Not available.";

type QueueSummary = {
  waitingStudentCount: number;
  uniqueRecipientCount: number;
  skippedCount: number;
  pending: number;
  sent: number;
  failed: number;
  sending?: number;
  skippedQueue?: number;
  lastPreparedAt: string | null;
};

type EmailQueuePreparation = {
  waitingStudentCount: number;
  uniqueRecipientCount: number;
  addedCount: number;
  alreadyPreparedCount: number;
  skippedCount: number;
};

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function queueRpcError(code?: string) {
  if (code === "42501") {
    return NextResponse.json({ error: GENERIC }, { status: 403 });
  }
  return NextResponse.json(
    { error: "Could not load the email queue." },
    { status: 500 },
  );
}

export async function GET() {
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc(
    "admin_waitlist_email_queue_summary",
    { p_actor_id: gate.userId },
  );
  if (error) return queueRpcError(error.code);

  const summary = data as QueueSummary | null;
  if (
    !summary ||
    !isCount(summary.waitingStudentCount) ||
    !isCount(summary.uniqueRecipientCount) ||
    summary.uniqueRecipientCount > summary.waitingStudentCount ||
    !isCount(summary.skippedCount) ||
    !isCount(summary.pending) ||
    !isCount(summary.sent) ||
    !isCount(summary.failed) ||
    (summary.sending !== undefined && !isCount(summary.sending)) ||
    (summary.skippedQueue !== undefined && !isCount(summary.skippedQueue)) ||
    (summary.lastPreparedAt !== null &&
      typeof summary.lastPreparedAt !== "string")
  ) {
    return NextResponse.json(
      { error: "Could not load the email queue." },
      { status: 500 },
    );
  }

  // Explicit response allowlist: never serialize the raw RPC object because
  // older/future SQL versions may include per-student or recipient fields.
  return NextResponse.json({
    waitingStudentCount: summary.waitingStudentCount,
    uniqueRecipientCount: summary.uniqueRecipientCount,
    skippedCount: summary.skippedCount,
    pending: summary.pending,
    sent: summary.sent,
    failed: summary.failed,
    ...(summary.sending !== undefined ? { sending: summary.sending } : {}),
    ...(summary.skippedQueue !== undefined ? { skippedQueue: summary.skippedQueue } : {}),
    lastPreparedAt: summary.lastPreparedAt,
  });
}

export async function POST(req: Request) {
  if (!verifySameOrigin(req).ok) {
    return NextResponse.json({ error: GENERIC }, { status: 403 });
  }
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });
  const rate = await insideMutationRateLimit(req, gate.userId);
  if (!rate.allowed) return NextResponse.json({ error: GENERIC }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds ?? 60) } });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc(
    "admin_prepare_waitlist_email_queue",
    { p_actor_id: gate.userId },
  );
  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ error: GENERIC }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Could not prepare the email queue." },
      { status: 500 },
    );
  }

  const result = data as EmailQueuePreparation | null;
  if (
    !result ||
    !isCount(result.waitingStudentCount) ||
    !isCount(result.uniqueRecipientCount) ||
    result.uniqueRecipientCount > result.waitingStudentCount ||
    !isCount(result.addedCount) ||
    !isCount(result.alreadyPreparedCount) ||
    result.addedCount + result.alreadyPreparedCount !==
      result.uniqueRecipientCount ||
     !isCount(result.skippedCount)
  ) {
    return NextResponse.json(
      { error: "Could not prepare the email queue." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    waitingStudentCount: result.waitingStudentCount,
    uniqueRecipientCount: result.uniqueRecipientCount,
    addedCount: result.addedCount,
    alreadyPreparedCount: result.alreadyPreparedCount,
    skippedCount: result.skippedCount,
  });
}
