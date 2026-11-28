/**
 * Server-only Brevo feedback-reply sender (one-way admin → student email).
 *
 * NEVER import from client components. Reads BREVO_API_KEY from server
 * environment only — the same variables, endpoint, and header conventions
 * as the verification sender (src/lib/email-verification/brevo.ts).
 * Delivery stays logically separate from verification mail: no queue
 * coupling, no shared templates, no campaign machinery.
 *
 * Recipient rule: the caller resolves the address from the trusted
 * verification_records.email (never client input, never the internal
 * u-...@us.signin.invalid identity). This module sends to exactly the
 * address it is given — resolution/validation lives with the caller.
 */

export type FeedbackReplyResult =
  | { kind: "success"; providerMessageId: string }
  | { kind: "config_error"; detail: string }
  | { kind: "permanent_failure"; detail: string }
  /** ambiguous=true when the request may have reached Brevo (timeout/network). */
  | { kind: "temporary_failure"; detail: string; ambiguous: boolean };

export const FEEDBACK_BREVO_TIMEOUT_MS = 10_000;

function sanitizedDetail(
  status: number,
  code: string | null,
  message: string | null,
): string {
  const parts = [`http ${status}`];
  if (code) parts.push(code.slice(0, 64));
  if (message) parts.push(message.slice(0, 120));
  return parts.join(" ").slice(0, 200);
}

export async function sendFeedbackReplyEmail(args: {
  to: string;
  username: string | null;
  replyBody: string;
}): Promise<FeedbackReplyResult> {
  if (typeof window !== "undefined") {
    throw new Error("sendFeedbackReplyEmail is server-only");
  }

  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME ?? "us";
  if (!apiKey || !senderEmail) {
    return { kind: "config_error", detail: "brevo sender is not configured" };
  }

  const greeting = args.username ? `Hi @${args.username},` : "Hi,";
  // Plain-text interpolation only — the reply body is a trusted admin
  // string, but it is still escaped for the HTML part below.
  const escaped = args.replyBody
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  let res: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEEDBACK_BREVO_TIMEOUT_MS);
  try {
    res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: args.to }],
        subject: "Re: Your feedback about us",
        htmlContent: `<p>${greeting}</p><p>${escaped}</p><p>—<br>us<br>just us.</p>`,
        textContent: `${greeting}\n\n${args.replyBody}\n\n—\nus\njust us.`,
      }),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      return {
        kind: "temporary_failure",
        detail: "brevo request timed out",
        ambiguous: true,
      };
    }
    const msg = e instanceof Error ? e.message.slice(0, 120) : "network error";
    return { kind: "temporary_failure", detail: msg, ambiguous: true };
  } finally {
    clearTimeout(timeout);
  }

  let bodyCode: string | null = null;
  let bodyMessage: string | null = null;
  let messageId = "";
  try {
    const data = (await res.json()) as {
      messageId?: string;
      messageIds?: string[];
      code?: string;
      message?: string;
    };
    if (typeof data?.messageId === "string") messageId = data.messageId;
    else if (
      Array.isArray(data?.messageIds) &&
      typeof data.messageIds[0] === "string"
    ) {
      messageId = data.messageIds[0];
    }
    if (typeof data?.code === "string") bodyCode = data.code;
    if (typeof data?.message === "string") bodyMessage = data.message;
  } catch {
    // Non-JSON body: classify on status alone.
  }

  if (res.status === 201 || res.status === 202) {
    return { kind: "success", providerMessageId: messageId };
  }
  const detail = sanitizedDetail(res.status, bodyCode, bodyMessage);
  if (res.status === 401 || res.status === 403) {
    return { kind: "config_error", detail };
  }
  if (res.status >= 400 && res.status < 500) {
    return { kind: "permanent_failure", detail };
  }
  return { kind: "temporary_failure", detail, ambiguous: false };
}
