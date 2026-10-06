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

/** Stale-claim recovery: a SENDING row this old is treated as crashed. */
const STALE_SENDING_MS = 10 * 60 * 1000;
/** Backoff before a temporary FAILED row becomes retryable. */
const TEMPORARY_RETRY_MS = 5 * 60 * 1000;
/** Upper bound per explicit send (the queue itself is audience-bounded). */
const SEND_BATCH_LIMIT = 1000;

type QueueRow = {
  id: string;
  user_id: string | null;
  email: string;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
  updated_at: string;
  last_error: string | null;
};

function isQueueRow(value: unknown): value is QueueRow {
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

function isRetryableFailed(row: QueueRow, now: number): boolean {
  if (row.status !== "FAILED") return false;
  if (!row.last_error || !row.last_error.startsWith("temporary:")) return false;
  if (!row.next_attempt_at) return true;
  const due = Date.parse(row.next_attempt_at);
  if (Number.isNaN(due)) return true;
  return due <= now;
}

function isStaleSending(row: QueueRow, now: number): boolean {
  if (row.status !== "SENDING") return false;
  const updated = Date.parse(row.updated_at);
  if (Number.isNaN(updated)) return true;
  return now - updated >= STALE_SENDING_MS;
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
  if (!verifySameOrigin(req).ok) {
    return NextResponse.json({ error: GENERIC }, { status: 403 });
  }
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });

  const { subject, message } = (await req.json().catch(() => ({}))) as {
    subject?: unknown;
    message?: unknown;
  };
  const contentError = validateWaitlistEmailContent(subject, message);
  if (contentError) {
    return NextResponse.json({ error: contentError }, { status: 400 });
  }
  const cleanSubject = (subject as string).trim();
  const cleanMessage = (message as string).trim();

  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
    return NextResponse.json(
      { error: "Email is not configured — nothing was sent." },
      { status: 502 },
    );
  }

  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    return NextResponse.json(
      { error: "Could not send the email." },
      { status: 500 },
    );
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
    return NextResponse.json(
      { error: "Could not send the email." },
      { status: 500 },
    );
  }

  const now = Date.now();
  const candidates = ((Array.isArray(rows) ? rows : []).filter(isQueueRow)).filter(
    (row) =>
      row.status === "PENDING" ||
      isRetryableFailed(row, now) ||
      isStaleSending(row, now),
  );

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of candidates) {
    // Race-safe claim: only the first concurrent sender wins. The
    // id + prior-status + updated_at guard means a row that another send
    // already claimed, sent, or finalized matches zero rows here.
    const claimedAt = new Date().toISOString();
    const { data: claimed } = await service
      .from("waitlist_email_queue")
      .update({
        status: "SENDING",
        attempts: row.attempts + 1,
        next_attempt_at: claimedAt,
        last_error: null,
      })
      .eq("id", row.id)
      .eq("status", row.status)
      .eq("updated_at", row.updated_at)
      .select("id");
    if (!claimed || (Array.isArray(claimed) && claimed.length === 0)) {
      continue;
    }
    attempted += 1;

    const skip = async (reason: string) => {
      await service
        .from("waitlist_email_queue")
        .update({ status: "SKIPPED", last_error: `skipped: ${reason}` })
        .eq("id", row.id)
        .eq("status", "SENDING");
      skipped += 1;
    };

    // Re-check current eligibility against live state. The snapshot email
    // is never rewritten and never substituted: any mismatch skips.
    if (!row.user_id) {
      await skip("profile missing");
      continue;
    }
    const { data: profile } = await service
      .from("profiles")
      .select("id, is_active")
      .eq("user_id", row.user_id)
      .maybeSingle();
    const prof = profile as { id?: unknown; is_active?: unknown } | null;
    if (!prof || typeof prof.id !== "string") {
      await skip("profile missing");
      continue;
    }
    if (prof.is_active === false) {
      await skip("profile suspended");
      continue;
    }
    const { data: photo } = await service
      .from("profile_photos")
      .select("id")
      .eq("profile_id", prof.id)
      .limit(1)
      .maybeSingle();
    if (!photo) {
      await skip("photo incomplete");
      continue;
    }
    const { data: vr } = await service
      .from("verification_records")
      .select("email")
      .eq("user_id", row.user_id)
      .maybeSingle();
    const current = normalizedEmail(
      (vr as { email?: unknown } | null)?.email,
    );
    if (!current) {
      await skip("email invalid");
      continue;
    }
    if (current !== row.email) {
      await skip("email changed");
      continue;
    }

    const delivered = await sendWaitlistEmail({
      to: row.email,
      subject: cleanSubject,
      message: cleanMessage,
    });
    if (delivered.kind === "success") {
      await service
        .from("waitlist_email_queue")
        .update({
          status: "SENT",
          provider_message_id: delivered.providerMessageId || null,
          sent_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id)
        .eq("status", "SENDING");
      sent += 1;
    } else if (delivered.kind === "config_error") {
      // Configuration flipped mid-batch: release the claim so the row
      // stays retryable and stop without marking it failed.
      await service
        .from("waitlist_email_queue")
        .update({
          status: "PENDING",
          next_attempt_at: new Date().toISOString(),
          last_error: "temporary: sender misconfigured",
        })
        .eq("id", row.id)
        .eq("status", "SENDING");
      attempted -= 1;
      break;
    } else if (delivered.kind === "permanent_failure") {
      await service
        .from("waitlist_email_queue")
        .update({
          status: "FAILED",
          next_attempt_at: new Date().toISOString(),
          last_error: `permanent: ${delivered.detail}`.slice(0, 500),
        })
        .eq("id", row.id)
        .eq("status", "SENDING");
      failed += 1;
    } else {
      await service
        .from("waitlist_email_queue")
        .update({
          status: "FAILED",
          next_attempt_at: new Date(now + TEMPORARY_RETRY_MS).toISOString(),
          last_error: `temporary: ${delivered.detail}`.slice(0, 500),
        })
        .eq("id", row.id)
        .eq("status", "SENDING");
      failed += 1;
    }
  }

  // Fresh durable counts are the source of truth for `remaining`.
  const { data: states } = await service
    .from("waitlist_email_queue")
    .select("status");
  let remaining = 0;
  if (Array.isArray(states)) {
    for (const s of states) {
      const st = (s as { status?: unknown }).status;
      if (st === "PENDING" || st === "SENDING") remaining += 1;
    }
  }

  // Best-effort (same reasoning as feedback replies): the emails already
  // delivered cannot be unsent, so an audit outage must not turn a
  // completed send into a retry prompt.
  const audited = await recordInsideAuditEvent("WAITLIST_EMAIL_SENT", {
    targetType: "waitlist_email_queue",
    metadata: { attempted, sent, failed, skipped },
  });
  if (!audited.ok) {
    console.error("[inside] waitlist email sent but audit failed");
  }

  return NextResponse.json({ attempted, sent, failed, skipped, remaining });
}
