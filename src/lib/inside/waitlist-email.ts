/**
 * Server-only waitlist email sender (Step 5: explicit prepared-queue send).
 *
 * NEVER import from client components. Reads BREVO_API_KEY from server
 * environment only — the same variables, endpoint, and header conventions
 * as the verification sender (src/lib/email-verification/brevo.ts) and the
 * feedback reply sender (src/lib/feedback/reply-email.ts). Delivery stays
 * narrowly scoped to the current prepared waitlist queue: no templates
 * table, no campaign machinery, no scheduling, no segmentation.
 *
 * Recipient rule: the caller resolves the address from the persisted
 * waitlist_email_queue snapshot row (never client input). This module sends
 * to exactly the address it is given — eligibility re-checks live with the
 * caller (the send route).
 */

export const WAITLIST_SUBJECT_MAX = 200;
export const WAITLIST_MESSAGE_MAX = 5000;
export const WAITLIST_BREVO_TIMEOUT_MS = 10_000;

export type WaitlistSendResult =
  | { kind: "success"; providerMessageId: string }
  | { kind: "config_error"; detail: string }
  | { kind: "permanent_failure"; detail: string }
  | { kind: "temporary_failure"; detail: string };

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

/**
 * Validate admin-controlled content server-side. The subject must not be
 * able to inject email headers (no CR/LF); the message is plain text and
 * is escaped for the HTML part at send time.
 */
export function validateWaitlistEmailContent(
  subject: unknown,
  message: unknown,
): string | null {
  if (typeof subject !== "string" || !subject.trim()) {
    return "Add a subject.";
  }
  const cleanSubject = subject.trim();
  if (/[\r\n]/.test(cleanSubject)) {
    return "The subject must be a single line.";
  }
  if (cleanSubject.length > WAITLIST_SUBJECT_MAX) {
    return `Keep the subject under ${WAITLIST_SUBJECT_MAX} characters.`;
  }
  if (typeof message !== "string" || !message.trim()) {
    return "Write a message first.";
  }
  if (message.trim().length > WAITLIST_MESSAGE_MAX) {
    return `Keep the message under ${WAITLIST_MESSAGE_MAX} characters.`;
  }
  return null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

export async function sendWaitlistEmail(args: {
  to: string;
  subject: string;
  message: string;
}): Promise<WaitlistSendResult> {
  if (typeof window !== "undefined") {
    throw new Error("sendWaitlistEmail is server-only");
  }

  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME ?? "us";
  if (!apiKey || !senderEmail) {
    return { kind: "config_error", detail: "brevo sender is not configured" };
  }

  const subject = args.subject.trim();
  const message = args.message.trim();

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    WAITLIST_BREVO_TIMEOUT_MS,
  );
  let res: Response;
  try {
    res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: args.to }],
        subject,
        htmlContent: `<p>${escapeHtml(message)}</p><p>—<br>us<br>just us.</p>`,
        textContent: `${message}\n\n—\nus\njust us.`,
      }),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const msg =
      e instanceof Error ? e.message.slice(0, 120) : "network error";
    if (name === "AbortError" || name === "TimeoutError") {
      return { kind: "temporary_failure", detail: "brevo request timed out" };
    }
    return { kind: "temporary_failure", detail: msg };
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
  return { kind: "temporary_failure", detail };
}
