/**
 * Server-only Brevo verification-email sender.
 *
 * NEVER import from client components. Reads BREVO_API_KEY from server
 * environment only. Never logs the API key, recipient email, or any
 * verification token/URL.
 *
 * Structured results let the queue worker classify without parsing HTTP:
 *   success            — Brevo HTTP 201, includes provider message id.
 *   rate_limited       — HTTP 429. retryAfterSeconds from
 *                        x-sib-ratelimit-reset when usable, else fallback.
 *   quota_exhausted    — Brevo `not_enough_credits`. Retryable, but only
 *                        after a conservative configured window (we do NOT
 *                        assume an exact 24h reset; the provider gives none).
 *   permanent_failure  — 4xx that will never succeed on retry (e.g. 400
 *                        missing_parameter). Must NOT be retried.
 *   config_error       — 401 / missing credentials. Operational failure,
 *                        never blind-retried.
 *   temporary_failure  — 5xx / network errors. Retryable with backoff.
 *
 * NOTE on fault injection: the staging-only BREVO_FORCE_* test seam used for
 * the queue proof has been REMOVED after the proof (see final report). This
 * module now contains production logic only: configuration, send, and error
 * classification. There is no code path that fakes a provider result.
 */

export const RATE_LIMIT_FALLBACK_SECONDS = 60;
export const QUOTA_RETRY_SECONDS_DEFAULT = 3600;

export type BrevoSendResult =
  | { kind: "success"; providerMessageId: string }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "quota_exhausted"; retryAfterSeconds: number }
  | { kind: "permanent_failure"; category: string; detail: string }
  | { kind: "config_error"; category: string; detail: string }
  | { kind: "temporary_failure"; category: string; detail: string };

export function getQuotaRetrySeconds(): number {
  const raw = process.env.BREVO_QUOTA_RETRY_SECONDS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 60 && n <= 86400) return n;
  return QUOTA_RETRY_SECONDS_DEFAULT;
}

/**
 * Parse Brevo's x-sib-ratelimit-reset into a seconds delay.
 * Observed format is not contractually fixed, so handle both shapes:
 * epoch seconds (>1e9) -> delta vs now; small positive ints -> seconds.
 * Anything unusable -> RATE_LIMIT_FALLBACK_SECONDS. Never 0 (no spin).
 */
export function parseRateLimitReset(value: string | null): number {
  if (!value) return RATE_LIMIT_FALLBACK_SECONDS;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return RATE_LIMIT_FALLBACK_SECONDS;
  if (n > 1_000_000_000) {
    const delta = n - Math.floor(Date.now() / 1000);
    if (delta < 1) return RATE_LIMIT_FALLBACK_SECONDS;
    return Math.min(delta, 3600);
  }
  if (n > 3600) return 3600;
  return n;
}

/** Redact a Brevo response body to a short, secret-free detail string. */
function sanitizedDetail(status: number, code: string | null, message: string | null): string {
  const parts = [`http ${status}`];
  if (code) parts.push(code.slice(0, 64));
  if (message) parts.push(message.slice(0, 120));
  return parts.join(" ").slice(0, 200);
}

function classifyStatus(
  status: number,
  headers: Headers,
  bodyCode: string | null,
  bodyMessage: string | null,
): BrevoSendResult {
  if (status === 201 || status === 202) {
    // messageId is attached by the caller (needs the parsed body).
    return { kind: "success", providerMessageId: "" };
  }
  if (status === 429) {
    return {
      kind: "rate_limited",
      retryAfterSeconds: parseRateLimitReset(headers.get("x-sib-ratelimit-reset")),
    };
  }
  if (bodyCode === "not_enough_credits") {
    return { kind: "quota_exhausted", retryAfterSeconds: getQuotaRetrySeconds() };
  }
  if (status === 401 || status === 403) {
    return {
      kind: "config_error",
      category: bodyCode ?? "unauthorized",
      detail: sanitizedDetail(status, bodyCode, bodyMessage),
    };
  }
  if (status >= 400 && status < 500) {
    return {
      kind: "permanent_failure",
      category: bodyCode ?? `http_${status}`,
      detail: sanitizedDetail(status, bodyCode, bodyMessage),
    };
  }
  return {
    kind: "temporary_failure",
    category: `http_${status}`,
    detail: sanitizedDetail(status, bodyCode, bodyMessage),
  };
}

export async function sendVerificationEmail(args: {
  to: string;
  verificationUrl: string;
}): Promise<BrevoSendResult> {
  if (typeof window !== "undefined") {
    throw new Error("sendVerificationEmail is server-only");
  }

  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME ?? "us";
  if (!apiKey || !senderEmail) {
    return {
      kind: "config_error",
      category: "missing_configuration",
      detail: "brevo sender is not configured",
    };
  }

  let res: Response;
  try {
    res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: args.to }],
        subject: "Verify your email for us",
        // The URL carries the verification token; never logged.
        htmlContent: `<p>hey \u{1F44B}</p><p>You added this email to your <strong>us</strong> account.</p><p>Click below to verify that you own this email.</p><p><a href="${args.verificationUrl}">Verify my email</a></p><p>This link expires in 15 minutes.</p><p>If you didn't request this, you can safely ignore this email.</p>`,
        textContent: `hey \u{1F44B}\n\nYou added this email to your us account.\n\nVerify that you own this email: ${args.verificationUrl}\n\nThis link expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 120) : "network error";
    return { kind: "temporary_failure", category: "network_error", detail: msg };
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
    else if (Array.isArray(data?.messageIds) && typeof data.messageIds[0] === "string") {
      messageId = data.messageIds[0];
    }
    if (typeof data?.code === "string") bodyCode = data.code;
    if (typeof data?.message === "string") bodyMessage = data.message;
  } catch {
    // Non-JSON body: classify on status alone.
  }

  const classified = classifyStatus(res.status, res.headers, bodyCode, bodyMessage);
  if (classified.kind === "success") {
    return { kind: "success", providerMessageId: messageId };
  }
  return classified;
}
