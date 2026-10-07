import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { verifySameOrigin } from "@/lib/inside/origin";
import { insideMutationRateLimit } from "@/lib/inside/mutation-rate-limit";

const GENERIC = "Not available.";

type QueueSummary = {
  waitingStudentCount: number;
  uniqueRecipientCount: number;
  skippedCount: number;
  students: EmailAudienceStudent[];
  pending: number;
  sent: number;
  failed: number;
  sending?: number;
  skippedQueue?: number;
  lastPreparedAt: string | null;
};

type EmailAudienceStudent = {
  username: string | null;
  nickname: string | null;
  usn: string | null;
  spot: number | null;
  email: string;
};

type EmailQueuePreparation = {
  waitingStudentCount: number;
  uniqueRecipientCount: number;
  addedCount: number;
  alreadyPreparedCount: number;
  skippedCount: number;
  students: EmailAudienceStudent[];
  recipients: string[];
};

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isAudienceStudent(value: unknown): value is EmailAudienceStudent {
  if (!value || typeof value !== "object") return false;
  const student = value as Record<string, unknown>;
  return (
    (student.username === null || typeof student.username === "string") &&
    (student.nickname === null || typeof student.nickname === "string") &&
    (student.usn === null || typeof student.usn === "string") &&
    (student.spot === null || isCount(student.spot)) &&
    typeof student.email === "string" &&
    student.email === student.email.trim().toLowerCase()
  );
}

function isAudienceStudents(value: unknown, count: number): value is EmailAudienceStudent[] {
  return Array.isArray(value) && value.length === count && value.every(isAudienceStudent);
}

function isRecipientSnapshot(value: unknown, count: number): value is string[] {
  if (!Array.isArray(value) || value.length !== count) return false;
  return (
    value.every(
      (email) =>
        typeof email === "string" && email === email.trim().toLowerCase(),
    ) &&
    new Set(value).size === count
  );
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

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_waitlist_email_queue_summary",
  );
  if (error) return queueRpcError(error.code);

  const summary = data as QueueSummary | null;
  if (
    !summary ||
    !isCount(summary.waitingStudentCount) ||
    !isCount(summary.uniqueRecipientCount) ||
    summary.uniqueRecipientCount > summary.waitingStudentCount ||
    !isCount(summary.skippedCount) ||
    !isAudienceStudents(summary.students, summary.waitingStudentCount) ||
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

  return NextResponse.json(summary);
}

export async function POST(req: Request) {
  if (!verifySameOrigin(req).ok) {
    return NextResponse.json({ error: GENERIC }, { status: 403 });
  }
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });
  const rate = await insideMutationRateLimit(req, gate.userId);
  if (!rate.allowed) return NextResponse.json({ error: GENERIC }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds ?? 60) } });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_prepare_waitlist_email_queue",
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
    !isCount(result.skippedCount) ||
    !isAudienceStudents(result.students, result.waitingStudentCount) ||
    !isRecipientSnapshot(result.recipients, result.uniqueRecipientCount)
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
    students: result.students,
    recipients: result.recipients,
  });
}
