import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { recordInsideAuditEvent } from "@/lib/inside/audit";
import { verifySameOrigin } from "@/lib/inside/origin";
import { insideMutationRateLimit } from "@/lib/inside/mutation-rate-limit";
import { readJsonBounded } from "@/lib/http/read-json-bounded";
import { validateFeedbackReply } from "@/lib/feedback/constants";
import { sendFeedbackReplyEmail } from "@/lib/feedback/reply-email";
import { isInternalEmail } from "@/lib/auth/internal-email";
import { hasRealVerifiedEmail } from "@/lib/auth/account.ts";
import { syncVerifiedEmailFromUser } from "@/lib/auth/sync-verified-email";
import { claimFailureResponse, providerFailurePlan } from "@/lib/feedback/reply-state";

/**
 * POST /api/inside/feedback/reply — reply to feedback by email
 * (feedback Step 3: one-way admin → student email, not a chat system).
 *
 * Body: { feedbackId: string, replyBody: string } ONLY. The server
 * derives recipient + student + admin from trusted database/session
 * state — recipient_email / student_id / admin_id are never accepted
 * from the client.
 *
 * Safe order: authenticate → authorize → load feedback → reject
 * resolved/already-replied rows → resolve the student email from
 * verification_records → validate the reply → atomically claim the
 * feedback → send through Brevo → finalize the claim + reply metadata in
 * ONE database transaction.
 *
 * Failure contract:
 *   - Resolved feedback, an existing reply, or a concurrent in-flight
 *     claim is refused with 409 BEFORE any provider call.
 *   - Definite Brevo failure (config, 4xx, 5xx response): the claim is
 *     RELEASED and the admin sees a 502; a retry is safe.
 *   - Ambiguous provider outcome (timeout/network): the claim is kept
 *     UNCONFIRMED, never auto-released, so a retry cannot silently
 *     double-send. Recovery requires the explicit recover route after
 *     checking the provider.
 *   - Brevo accepted but finalization failed: the email is already out;
 *     the claim remains SENDING with the reply body durably stored so the
 *     recover route can record it without sending again. The response
 *     says emailSent:true + persistPending:true.
 *   - The reply audit event is best-effort: failing the whole operation
 *     on an audit outage would invite a resend of an already-delivered
 *     email. The gap is covered by server-side logs.
 *
 * Replying never resolves: status is untouched here.
 */
const GENERIC = "Not available.";

function isUsableRecipient(email: unknown): email is string {
  if (typeof email !== "string") return false;
  const v = email.trim();
  if (!v || v.length > 320) return false;
  if (isInternalEmail(v)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

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
  const { feedbackId, replyBody } = parsed as {
    feedbackId?: unknown;
    replyBody?: unknown;
  };
  if (typeof feedbackId !== "string" || !feedbackId.trim()) {
    return NextResponse.json({ error: "Pass a feedbackId." }, { status: 400 });
  }
  const replyError = validateFeedbackReply(replyBody);
  if (replyError) {
    return NextResponse.json({ error: replyError }, { status: 400 });
  }
  const cleanReply = (replyBody as string).trim();

  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    return NextResponse.json(
      { error: "Could not send the reply." },
      { status: 500 },
    );
  }

  // Load the feedback row through the privileged client (students have
  // no admin read path; the admin gate above authorizes this read).
  const { data: fb, error: fbError } = await service
    .from("feedback")
    .select("id, user_id, category, status")
    .eq("id", feedbackId.trim())
    .maybeSingle();
  if (fbError || !fb) {
    return NextResponse.json({ error: "Feedback not found." }, { status: 404 });
  }
  const row = fb as {
    id: string;
    user_id: string;
    category: string;
    status: string;
  };
  if (row.status !== "OPEN") {
    return NextResponse.json(
      { error: "This feedback is resolved — reply not sent." },
      { status: 409 },
    );
  }

  // Resolve the recipient from the trusted onboarding email record —
  // never client input, never the internal sign-in identity.
  const { data: authAccount } = await service.auth.admin.getUserById(row.user_id);
  const { data: initialVr } = await service
    .from("verification_records")
    .select("email, email_verified_at")
    .eq("user_id", row.user_id)
    .maybeSingle();
  let vr = initialVr;
  if (
    !isUsableRecipient((vr as { email?: unknown } | null)?.email) ||
    !(vr as { email_verified_at?: unknown } | null)?.email_verified_at
  ) {
    const sync = await syncVerifiedEmailFromUser(authAccount.user, service);
    if (sync.ok) {
      const { data: refreshedVr } = await service
        .from("verification_records")
        .select("email, email_verified_at")
        .eq("user_id", row.user_id)
        .maybeSingle();
      vr = refreshedVr;
    }
  }
  const recipient = (vr as { email?: unknown } | null)?.email;
  const confirmedAuthEmail = authAccount.user?.email;
  if (
    !isUsableRecipient(recipient) ||
    !(vr as { email_verified_at?: unknown } | null)?.email_verified_at ||
    !confirmedAuthEmail ||
    !hasRealVerifiedEmail(authAccount.user) ||
    confirmedAuthEmail.trim().toLowerCase() !== String(recipient).trim().toLowerCase()
  ) {
    return NextResponse.json(
      { error: "No usable email on file for this student — reply not sent." },
      { status: 422 },
    );
  }

  // Student display name for the greeting (public profile field only).
  const { data: prof } = await service
    .from("profiles")
    .select("username")
    .eq("user_id", row.user_id)
    .maybeSingle();
  const username =
    (prof as { username?: unknown } | null)?.username &&
    typeof (prof as { username: unknown }).username === "string"
      ? ((prof as { username: string }).username ?? null)
      : null;

  // Idempotency gate: one atomic claim per feedback. The reply body and
  // server-derived admin id are stored with the claim itself, so a
  // provider-success/database-failure can be recovered without resending.
  const claimToken = randomUUID();
  const { data: claimData, error: claimError } = await service.rpc(
    "admin_claim_feedback_reply",
    {
      p_feedback_id: row.id,
        p_claim_token: claimToken,
        p_reply_body: cleanReply,
        p_actor_id: gate.userId,
    },
  );
  if (claimError) {
    if (claimError.code === "02000") {
      return NextResponse.json({ error: "Feedback not found." }, { status: 404 });
    }
    if (claimError.code === "42501") {
      return NextResponse.json({ error: GENERIC }, { status: 403 });
    }
    return NextResponse.json({ error: "Could not start the reply." }, { status: 500 });
  }
  const claim = claimData as { ok?: unknown; reason?: unknown } | null;
  if (claim?.ok !== true) {
    const failure = claimFailureResponse(claim?.reason);
    return NextResponse.json(
      { error: failure.error, replyState: failure.reason },
      { status: failure.status },
    );
  }

  const sent = await sendFeedbackReplyEmail({
    to: recipient.trim(),
    username,
    replyBody: cleanReply,
  });
  if (sent.kind !== "success") {
    const plan = providerFailurePlan(sent);
    const { data: settled } = await service.rpc(
      "admin_settle_feedback_reply_claim",
      {
        p_feedback_id: row.id,
        p_claim_token: claimToken,
        p_state: plan.settle,
        p_last_error:
          plan.settle === "UNCONFIRMED"
            ? `unconfirmed: ${sent.detail}`.slice(0, 500)
            : `${sent.kind}: ${sent.detail}`.slice(0, 500),
        p_actor_id: gate.userId,
      },
    );
    if ((settled as { ok?: unknown } | null)?.ok !== true) {
      console.error("[inside] feedback reply claim could not be settled");
    }
    return NextResponse.json(
      {
        error: plan.error,
        emailSent: plan.emailSent,
        ...(plan.unconfirmed ? { unconfirmed: true } : {}),
      },
      { status: plan.status },
    );
  }

  // Provider accepted the message. Finalize the claim and the feedback
  // reply metadata in ONE transaction; if this fails, the stored claim is
  // the recovery source and no resend is required.
  const { data: finalized, error: finalizeError } = await service.rpc(
    "admin_finalize_feedback_reply",
    {
      p_feedback_id: row.id,
      p_claim_token: claimToken,
      p_provider_message_id: sent.providerMessageId || null,
      p_actor_id: gate.userId,
    },
  );
  if (finalizeError || (finalized as { ok?: unknown } | null)?.ok !== true) {
    // The email is already delivered and cannot be unsent: say so
    // explicitly (emailSent:true) instead of an ambiguous error that
    // invites a double-send. The stored claim blocks blind retries.
    console.error("[inside] feedback reply sent but not recorded");
    return NextResponse.json(
      {
        error:
          "The email was sent but recording it failed — check the feedback row before recovering.",
        emailSent: true,
        persistPending: true,
      },
      { status: 500 },
    );
  }

  // Best-effort (see header): an audit outage must not turn a delivered
  // email into a retry prompt.
  const audited = await recordInsideAuditEvent("FEEDBACK_REPLIED", {
    targetType: "feedback",
    targetId: row.id,
    metadata: { category: row.category },
  });
  if (!audited.ok) {
    console.error("[inside] feedback reply audit failed (reply already recorded)");
  }

  return NextResponse.json({ ok: true, replied: true });
}
