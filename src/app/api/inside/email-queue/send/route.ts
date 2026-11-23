import { NextResponse } from "next/server";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { recordInsideAuditEvent } from "@/lib/inside/audit";
import { verifySameOrigin } from "@/lib/inside/origin";
import { isInternalEmail } from "@/lib/auth/internal-email";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  sendWaitlistEmail,
  validateWaitlistEmailContent,
} from "@/lib/inside/waitlist-email";
import { perfLog, perfStart } from "@/lib/utils/perf";
import { insideMutationRateLimit } from "@/lib/inside/mutation-rate-limit";
import { readJsonBounded } from "@/lib/http/read-json-bounded";
import {
  TEMPORARY_RETRY_MS,
  runEmailQueueSend,
  type QueueSendRow,
  type QueueSendStore,
} from "@/lib/inside/email-queue-send-runner";

/**
 * POST /api/inside/email-queue/send — explicit send of the prepared
 * waitlist email (Step 5).
 *
 * This is the ONLY operation that may call Brevo for the waitlist queue.
 * Preparation (POST /api/inside/email-queue), preview, GET, and page loads
 * never send. The body carries ONLY admin-controlled content
 * ({ subject, message }); recipients come exclusively from the persisted
 * waitlist_email_queue snapshot — never client input, never the general
 * Students directory, never a rebuilt audience query.
 *
 * Per-recipient safety order:
 *   1. atomic claim PENDING (or retryable FAILED / stale SENDING) -> SENDING
 *      via an id + prior-status + updated_at guarded UPDATE, so concurrent
 *      sends (double-click, retry, second tab) cannot deliver twice;
 *   2. re-check current eligibility (profile exists, active, photo-complete,
 *      current verified email valid and EQUAL to the snapshot — never
 *      silently substitute a changed email);
 *   3. ineligible -> SKIPPED (durable, terminal, reported);
 *   4. eligible -> Brevo -> SENT (provider id + sent_at) or FAILED
 *      (temporary: retryable with backoff; permanent: terminal).
 *
 * SENT rows are never sent again. Successful sends are never rolled back.
 * The audit event carries aggregate counts only (no addresses, no content).
 */
const GENERIC = "Not available.";

/** Upper bound per explicit send (the queue itself is audience-bounded). */
const SEND_BATCH_LIMIT = 25;

function isQueueRow(value: unknown): value is QueueSendRow {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    (r.user_id === null || typeof r.user_id === "string") &&
    typeof r.email === "string" &&
    typeof r.status === "string" &&
    typeof r.attempts === "number" &&
    (r.next_attempt_at === null || typeof r.next_attempt_at === "string") &&
    typeof r.updated_at === "string" &&
    (r.last_error === null || typeof r.last_error === "string")
  );
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (isInternalEmail(email)) return null;
  return email;
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}

export async function POST(req: Request) {
  const perf = perfStart();
  const respond = (body: unknown, init: ResponseInit = {}) => {
    perfLog("inside.email-queue.send", perf);
    return NextResponse.json(body, init);
  };
  if (!verifySameOrigin(req).ok) {
    return respond({ error: GENERIC }, { status: 403 });
  }
  const gate = await requireInsideAdmin();
  if (!gate) return respond({ error: GENERIC }, { status: 403 });
  const rate = await insideMutationRateLimit(req, gate.userId);
  if (!rate.allowed) return respond({ error: GENERIC }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds ?? 60) } });

  const parsed = await readJsonBounded<Record<string, unknown>>(req, 16_384);
  if (!parsed) return respond({ error: "Invalid request body." }, { status: 400 });
  const { subject, message } = parsed as {
    subject?: unknown;
    message?: unknown;
  };
  const contentError = validateWaitlistEmailContent(subject, message);
  if (contentError) {
    return respond({ error: contentError }, { status: 400 });
  }
  const cleanSubject = (subject as string).trim();
  const cleanMessage = (message as string).trim();

  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
    return respond({ error: "Email is not configured — nothing was sent." }, { status: 502 });
  }

  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    return respond({ error: "Could not send the email." }, { status: 500 });
  }

  const { data: rows, error: listError } = await service
    .from("waitlist_email_queue")
    .select(
      "id, user_id, email, status, attempts, next_attempt_at, updated_at, last_error",
    )
    .in("status", ["PENDING", "SENDING", "FAILED"])
    .order("created_at", { ascending: true })
    .limit(SEND_BATCH_LIMIT);
  if (listError) {
    return respond({ error: "Could not send the email." }, { status: 500 });
  }

  const now = Date.now();
  const parsedRows = (Array.isArray(rows) ? rows : []).filter(isQueueRow);
  const updatePersisted = (data: unknown): boolean =>
    Array.isArray(data) && data.length > 0;

  const store: QueueSendStore = {
    async claim(row) {
      // Race-safe claim: id + prior-status + updated_at guard means a row
      // another send already claimed, sent, or finalized matches zero rows.
      const { data, error } = await service
        .from("waitlist_email_queue")
        .update({
          status: "SENDING",
          attempts: row.attempts + 1,
          next_attempt_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id)
        .eq("status", row.status)
        .eq("updated_at", row.updated_at)
        .select("id");
      return !error && updatePersisted(data);
    },

    async eligibility(row) {
      // Re-check live state. The snapshot email is never rewritten and
      // never substituted: any mismatch skips.
      if (!row.user_id) return "profile missing";
      const { data: profile } = await service
        .from("profiles")
        .select("id, is_active")
        .eq("user_id", row.user_id)
        .maybeSingle();
      const prof = profile as { id?: unknown; is_active?: unknown } | null;
      if (!prof || typeof prof.id !== "string") return "profile missing";
      if (prof.is_active === false) return "profile suspended";
      const { data: photo } = await service
        .from("profile_photos")
        .select("id")
        .eq("profile_id", prof.id)
        .limit(1)
        .maybeSingle();
      if (!photo) return "photo incomplete";
      const { data: vr } = await service
        .from("verification_records")
        .select("email")
        .eq("user_id", row.user_id)
        .maybeSingle();
      const current = normalizedEmail(
        (vr as { email?: unknown } | null)?.email,
      );
      if (!current) return "email invalid";
      if (current !== row.email) return "email changed";
      return null;
    },

    async settleSkip(row, reason) {
      const { data, error } = await service
        .from("waitlist_email_queue")
        .update({ status: "SKIPPED", last_error: `skipped: ${reason}` })
        .eq("id", row.id)
        .eq("status", "SENDING")
        .select("id");
      return !error && updatePersisted(data);
    },

    async releaseConfig(row) {
      const { data, error } = await service
        .from("waitlist_email_queue")
        .update({
          status: "PENDING",
          next_attempt_at: new Date().toISOString(),
          last_error: "temporary: sender misconfigured",
        })
        .eq("id", row.id)
        .eq("status", "SENDING")
        .select("id");
      return !error && updatePersisted(data);
    },

    async settleSent(row, providerMessageId) {
      const { data, error } = await service
        .from("waitlist_email_queue")
        .update({
          status: "SENT",
          provider_message_id: providerMessageId,
          sent_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id)
        .eq("status", "SENDING")
        .select("id");
      return !error && updatePersisted(data);
    },

    async settleFailed(row, permanent, detail) {
      const { data, error } = await service
        .from("waitlist_email_queue")
        .update({
          status: "FAILED",
          next_attempt_at: new Date(
            permanent ? Date.now() : now + TEMPORARY_RETRY_MS,
          ).toISOString(),
          last_error: (permanent
            ? `permanent: ${detail}`
            : `temporary: ${detail}`
          ).slice(0, 500),
        })
        .eq("id", row.id)
        .eq("status", "SENDING")
        .select("id");
      return !error && updatePersisted(data);
    },

    async markUnconfirmed(row, detail) {
      // Best-effort marker on the still-SENDING row. It excludes the row
      // from stale-SENDING reclaim, so a provider success whose SENT
      // update failed is never resent automatically.
      const { data, error } = await service
        .from("waitlist_email_queue")
        .update({ last_error: detail.slice(0, 500) })
        .eq("id", row.id)
        .eq("status", "SENDING")
        .select("id");
      return !error && updatePersisted(data);
    },
  };

  const counts = await runEmailQueueSend({
    rows: parsedRows,
    store,
    now,
    send: (row) =>
      sendWaitlistEmail({
        to: row.email,
        subject: cleanSubject,
        message: cleanMessage,
      }),
  });
  const { attempted, sent, failed, skipped, unrecorded, unconfirmed } = counts;

  // Fresh durable counts are the source of truth for `remaining`.
  const { count: remainingCount } = await service
    .from("waitlist_email_queue")
    .select("id", { count: "exact", head: true })
    .in("status", ["PENDING", "SENDING"]);
  const remaining = remainingCount ?? 0;

  // Best-effort (same reasoning as feedback replies): the emails already
  // delivered cannot be unsent, so an audit outage must not turn a
  // completed send into a retry prompt.
  const audited = await recordInsideAuditEvent("WAITLIST_EMAIL_SENT", {
    targetType: "waitlist_email_queue",
    metadata: { attempted, sent, failed, skipped, unrecorded, unconfirmed },
  });
  if (!audited.ok) {
    console.error("[inside] waitlist email sent but audit failed");
  }

  return respond({ attempted, sent, failed, skipped, unrecorded, unconfirmed, remaining });
}
