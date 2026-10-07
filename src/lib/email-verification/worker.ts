/**
 * Email-verification worker glue (server-only): request intake + per-attempt
 * delivery with just-in-time token minting.
 *
 * WHY JUST-IN-TIME (the queue-retry answer): the delivery queue deliberately
 * stores no tokens, so after a worker crash or a Brevo 429 there is no
 * plaintext to recover — and sha256(token) cannot be reversed. Instead of
 * persisting plaintext, the worker mints a FRESH token on every actual send
 * attempt (invalidating predecessors for that user+email) and holds the URL
 * only in memory for that one Brevo call:
 *
 * - crash before send: nothing (or an unknown, soon-invalidated token) was
 *   ever delivered; the reclaimed job mints anew. Safe.
 * - Brevo 429/5xx/network: nothing was delivered; retry mints anew, the
 *   previous hash is invalidated. Safe.
 * - Brevo ACCEPTED then finalize failed (lease lost / crash): the first
 *   email WAS delivered, but the job returns to pending and the retry mints
 *   a successor that invalidates the delivered token. The user may receive
 *   two emails of which only the latest link works (at-most-once DB finalize
 *   vs at-least-once delivery — inherent, documented, fail-closed).
 * - older email clicked: predecessor was invalidated at mint time, so the
 *   consume RPC rejects it with the same generic error as an expired link.
 *
 * Dedupe: the queue's partial unique index allows one ACTIVE (pending/
 * sending) job per user+email; mint-time invalidation allows one ACTIVE
 * token per user+email; the request path adds a resend cooldown. Resend is
 * an explicit POST that either reuses active work or queues fresh delivery
 * whose send mints a successor token.
 *
 * The email is associated with the SAME auth.users.id via
 * verification_records.user_id (upsert — no signUp, no second account, no
 * UID change). auth.users.email is deliberately NOT touched in this slice:
 * attaching it via updateUser() would send Supabase's own email, and
 * admin.updateUserById(..., email_confirm:true) would falsely certify
 * ownership. The Auth linkage happens in a later slice, after this trust
 * state is proven. Until consume succeeds, email_verified_at stays NULL and
 * the address must not be trusted (e.g. for recovery — unchanged here).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claimJob,
  enqueueVerificationEmail,
  isPlausibleEmail,
  normalizeEmail,
  processClaimedJob,
  type ProcessOutcome,
  type QueueJob,
} from "./queue";
import { sendVerificationEmail } from "./brevo";
import {
  buildVerificationUrl,
  mintVerificationToken,
  TOKEN_TTL_SECONDS,
} from "./tokens";

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error("email-verification worker is server-only");
  }
}

/** Minimum seconds between verification sends for the same user+email. */
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_VERIFICATION_EMAILS_PER_ACCOUNT_DAY = 5;

export type VerificationRequestResult =
  | { ok: true; deduplicated: boolean }
  | { ok: false; error: string; retryAfterSeconds?: number; code: "unauthenticated" | "invalid" | "cooldown" | "unavailable" };

/**
 * Intake: validate, bind the email to the CURRENT session user (same UID),
 * reset trust when the address changed, enforce the resend cooldown, and
 * enqueue delivery. Mints NO token — the send attempt mints its own.
 *
 * sessionClient is the request's cookie session (auth.getUser derives the
 * user — never a client-supplied user_id). serviceClient bypasses RLS for
 * the upsert/enqueue/cooldown reads.
 */
export async function requestEmailVerification(
  sessionClient: Pick<SupabaseClient, "auth">,
  serviceClient: SupabaseClient,
  rawEmail: string,
): Promise<VerificationRequestResult> {
  assertServer();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated.", code: "unauthenticated" };
  const trimmed = rawEmail.trim();
  if (trimmed.length > 254) return { ok: false, error: "Enter a valid email.", code: "invalid" };
  const normalized = normalizeEmail(trimmed);
  if (!isPlausibleEmail(normalized)) return { ok: false, error: "Enter a valid email.", code: "invalid" };

  // Account-wide daily quota prevents bypass by rotating recipient addresses.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount, error: quotaError } = await serviceClient
    .from("email_verification_queue")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", dayAgo);
  if (quotaError) return { ok: false, error: "Verification is unavailable right now.", code: "unavailable" };
  if ((dailyCount ?? 0) >= MAX_VERIFICATION_EMAILS_PER_ACCOUNT_DAY) {
    return { ok: false, error: "Too many verification requests. Try again later.", retryAfterSeconds: 3600, code: "cooldown" };
  }

  const { data: existing } = await serviceClient
    .from("verification_records")
    .select("email, email_verified_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing && typeof (existing as { email?: unknown }).email === "string") {
    // Resend cooldown: a token minted (i.e. an email actually sent) moments
    // ago means the inbox already has a live link — do not burn quota.
    const { data: recent } = await serviceClient
      .from("email_verification_tokens")
      .select("created_at")
      .eq("user_id", user.id)
      .eq("normalized_email", normalized)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const createdAt = (recent as { created_at?: string } | null)?.created_at;
    if (createdAt && Date.now() - Date.parse(createdAt) < RESEND_COOLDOWN_SECONDS * 1000) {
      return {
        ok: false,
        error: "A verification email was just sent. Check your inbox before requesting another.",
        retryAfterSeconds: RESEND_COOLDOWN_SECONDS,
        code: "cooldown",
      };
    }
  }

  // Changing the address (or adding the first one) drops trust; keeping the
  // same address preserves an existing verification.
  const sameEmail =
    typeof (existing as { email?: unknown } | null)?.email === "string" &&
    normalizeEmail(String((existing as { email: string }).email)) === normalized;
  const payload: Record<string, unknown> = {
    user_id: user.id,
    email: trimmed,
    email_skipped: false,
  };
  if (!sameEmail) payload.email_verified_at = null;
  const { error: upsertError } = await serviceClient
    .from("verification_records")
    .upsert(payload, { onConflict: "user_id" });
  if (upsertError) return { ok: false, error: "Could not save email. Try again.", code: "unavailable" };

  const enqueued = await enqueueVerificationEmail(serviceClient, {
    userId: user.id,
    email: normalized,
    expiresInSeconds: TOKEN_TTL_SECONDS,
  });
  if (!enqueued.ok) return { ok: false, error: "Could not queue verification email. Try again.", code: "unavailable" };
  return { ok: true, deduplicated: enqueued.deduplicated };
}

export type VerificationTickResult =
  | { claimed: false; reason: "empty_or_cooldown" }
  | { claimed: true; result: ProcessOutcome };

/**
 * One worker tick: claim a due job, then process it with a minting sender.
 * The sender mints AFTER the queue's expiry/cooldown gates pass (they run
 * inside processClaimedJob before the sender is invoked), so gated-out jobs
 * never mint dangling tokens. The passed verificationUrl is intentionally
 * unused — the minting sender owns URL generation per attempt (see above).
 */
export async function runVerificationTick(
  serviceClient: SupabaseClient,
  args: {
    leaseOwner: string;
    appBaseUrl: string;
    sender?: (a: { to: string; verificationUrl: string }) => Promise<
      | { kind: "success"; providerMessageId: string }
      | { kind: "rate_limited"; retryAfterSeconds: number }
      | { kind: "quota_exhausted"; retryAfterSeconds: number }
      | { kind: "permanent_failure"; category: string; detail: string }
      | { kind: "config_error"; category: string; detail: string }
      | { kind: "temporary_failure"; category: string; detail: string }
    >;
    leaseSeconds?: number;
  },
): Promise<VerificationTickResult> {
  assertServer();
  const { job } = await claimJob(serviceClient, args.leaseOwner, args.leaseSeconds);
  if (!job) return { claimed: false, reason: "empty_or_cooldown" };
  const sender = args.sender ?? sendVerificationEmail;
  const mintingSender = async ({ to }: { to: string; verificationUrl: string }) => {
    const minted = await mintVerificationToken(serviceClient, {
      userId: (job as QueueJob).user_id,
      email: (job as QueueJob).email,
    });
    if (!minted.ok) {
      return {
        kind: "temporary_failure" as const,
        category: "token_mint_failed",
        detail: "verification mint unavailable; retry scheduled",
      };
    }
    return sender({ to, verificationUrl: buildVerificationUrl(args.appBaseUrl, minted.token) });
  };
  const result = await processClaimedJob(serviceClient, job, args.leaseOwner, mintingSender, "");
  return { claimed: true, result };
}
