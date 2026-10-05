import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { recordInsideAuditEvent } from "@/lib/inside/audit";
import { verifySameOrigin } from "@/lib/inside/origin";
import { validateFeedbackReply } from "@/lib/feedback/constants";
import { sendFeedbackReplyEmail } from "@/lib/feedback/reply-email";
import { isInternalEmail } from "@/lib/auth/internal-email";

/**
 * POST /api/inside/feedback/reply — reply to feedback by email
 * (feedback Step 3: one-way admin → student email, not a chat system).
 *
 * Body: { feedbackId: string, replyBody: string } ONLY. The server
 * derives recipient + student + admin from trusted database/session
 * state — recipient_email / student_id / admin_id are never accepted
 * from the client.
 *
 * Safe order: authenticate → authorize → load feedback → resolve the
 * student email from verification_records → validate the reply → send
 * through Brevo → persist reply metadata ONLY on success.
 *
 * Failure contract:
 *   - Brevo unavailable / invalid recipient: the row is unchanged, the
 *     admin sees the failure (502 / 422).
 *   - Brevo accepted but the persist failed: the email is already out
 *     and cannot be unsent — the route returns emailSent:true with a
 *     do-not-blindly-retry message instead of an ambiguous error, so a
 *     retry does not silently double-send. (Documented Step 3
 *     limitation: no queue/idempotency layer is built here.)
 *   - The reply audit event is best-effort for the same reason: failing
 *     the whole operation on an audit outage would invite a resend of an
 *     already-delivered email. The gap is covered by server-side logs.
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

  const { feedbackId, replyBody } = await req.json().catch(() => ({}));
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

  // Resolve the recipient from the trusted onboarding email record —
  // never client input, never the internal sign-in identity.
  const { data: vr } = await service
    .from("verification_records")
    .select("email")
    .eq("user_id", row.user_id)
    .maybeSingle();
  const recipient = (vr as { email?: unknown } | null)?.email;
  if (!isUsableRecipient(recipient)) {
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

  const sent = await sendFeedbackReplyEmail({
    to: recipient.trim(),
    username,
    replyBody: cleanReply,
  });
  if (sent.kind !== "success") {
    // Nothing persisted: the row is unchanged and a retry is safe.
    const msg =
      sent.kind === "config_error"
        ? "Email is not configured — reply not sent."
        : "Could not send the reply. Nothing was recorded — try again.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Persist reply metadata only after Brevo accepted the message.
  const { error: persistError } = await service
    .from("feedback")
    .update({
      admin_reply: cleanReply,
      replied_at: new Date().toISOString(),
      replied_by: gate.userId,
      brevo_message_id: sent.providerMessageId || null,
    })
    .eq("id", row.id);
  if (persistError) {
    // The email is already delivered and cannot be unsent: say so
    // explicitly (emailSent:true) instead of an ambiguous error that
    // invites a double-send. The admin checks the row before resending.
    console.error("[inside] feedback reply sent but not recorded");
    return NextResponse.json(
      {
        error:
          "The email was sent but recording it failed — check the feedback row before resending.",
        emailSent: true,
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
