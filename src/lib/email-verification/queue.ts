/**
 * Email-verification DELIVERY queue (staging slice).
 *
 * Isolated infrastructure: no onboarding/login/recovery changes, no token
 * issuance, no verification endpoint. Delivery state only — the queue never
 * stores tokens; the caller supplies a verification URL at send time (the
 * future token system owns that URL; the proof passes an obvious
 * placeholder, never a real token).
 *
 * Identity: user_id is ALWAYS the server-derived auth.users.id. Callers must
 * obtain it from auth.getUser() on a server session (see
 * enqueueForAuthenticatedUser). Never accept a client-supplied user_id,
 * never mint users here, never touch UID/email ownership.
 *
 * Email normalization (dedupe identity): trim + lowercase ONLY. Deliberately
 * NO plus-tag stripping or dot manipulation — those are provider-specific
 * rewrites that risk merging distinct mailboxes. dedupe_key =
 * sha256 hex "<user_id>|<normalized email>".
 *
 * Retry policy:
 *   429 rate_limited    -> pending, next_retry_at = now + provider reset
 *                          (fallback 60s), global provider cooldown set.
 *   quota_exhausted     -> pending, next_retry_at = now + configured window
 *                          (BREVO_QUOTA_RETRY_SECONDS, default 3600s; we do
 *                          not assume a 24h reset), global cooldown set.
 *   temporary (5xx/net)-> pending, exponential backoff min(2^attempts*30s,
 *                          3600s); FAILED after MAX_ATTEMPTS (10).
 *   permanent 4xx       -> failed immediately, never retried.
 *   401 / config_error  -> failed immediately, never blind-retried.
 *   expired             -> expired before any send (pre-send gate + sweep).
 *
 * Lease: claims stamp status='sending' + owner + expiry (default 120s,
 * range 10..900s enforced in SQL). Attempts increment only when a processing
 * attempt COMPLETES, so a crashed worker never burns an attempt; its row
 * becomes reclaimable at lease expiry. Finalizing UPDATEs are guarded by
 * (id, lease_owner, status='sending') so a stale worker cannot clobber a
 * re-claimed row.
 *
 * Logging: safeJobLog exposes queue id, status, attempt, error category,
 * next_retry_at, provider message id ONLY. No emails, no user ids, no
 * tokens, no keys — ever.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendVerificationEmail, type BrevoSendResult } from "./brevo";

export const LEASE_SECONDS_DEFAULT = 120;
export const MAX_ATTEMPTS = 10;
export const TEMP_BACKOFF_BASE_SECONDS = 30;
export const TEMP_BACKOFF_MAX_SECONDS = 3600;
export const TOKEN_TTL_SECONDS = 15 * 60;

export type QueueStatus = "pending" | "sending" | "sent" | "failed" | "expired";

export interface QueueJob {
  id: string;
  user_id: string;
  email: string;
  dedupe_key: string;
  status: QueueStatus;
  attempts: number;
  next_retry_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error_category: string | null;
  last_error: string | null;
  provider_message_id: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export type Sender = (args: { to: string; verificationUrl: string }) => Promise<BrevoSendResult>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isPlausibleEmail(normalized: string): boolean {
  if (normalized.length < 3 || normalized.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function dedupeKeyFor(userId: string, normalizedEmail: string): string {
  return createHash("sha256").update(`${userId}|${normalizedEmail}`, "utf8").digest("hex");
}

export function backoffSeconds(priorAttempts: number): number {
  const exp = Math.min(priorAttempts, 8);
  return Math.min(TEMP_BACKOFF_BASE_SECONDS * 2 ** exp, TEMP_BACKOFF_MAX_SECONDS);
}

/** Safe log shape: ids + status + counters + timings only. */
export function safeJobLog(
  job: Pick<
    QueueJob,
    "id" | "status" | "attempts" | "last_error_category" | "next_retry_at" | "provider_message_id"
  >,
): Record<string, unknown> {
  return {
    queue_id: job.id,
    status: job.status,
    attempts: job.attempts,
    error_category: job.last_error_category,
    next_retry_at: job.next_retry_at,
    provider_message_id: job.provider_message_id,
  };
}

export type EnqueueResult = { ok: true; job: QueueJob; deduplicated: boolean } | { ok: false; error: string };

export async function enqueueVerificationEmail(
  client: SupabaseClient,
  args: { userId: string; email: string; expiresInSeconds?: number },
): Promise<EnqueueResult> {
  if (!args.userId) return { ok: false, error: "missing user identity" };
  const normalized = normalizeEmail(args.email);
  if (!isPlausibleEmail(normalized)) return { ok: false, error: "invalid email" };
  const ttl = args.expiresInSeconds ?? TOKEN_TTL_SECONDS;
  const now = Date.now();
  const row = {
    user_id: args.userId,
    email: normalized,
    dedupe_key: dedupeKeyFor(args.userId, normalized),
    status: "pending",
    next_retry_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttl * 1000).toISOString(),
  };
  const { data, error } = await client.from("email_verification_queue").insert(row).select().single();
  if (!error && data) return { ok: true, job: data as QueueJob, deduplicated: false };
  if (error && (error as { code?: string }).code === "23505") {
    // Active (pending/sending) row already exists: reuse it. No new job, no
    // quota burn, no attempt reset. The partial unique index is the guard;
    // this lookup only returns the existing work.
    const existing = await client
      .from("email_verification_queue")
      .select("*")
      .eq("dedupe_key", row.dedupe_key)
      .in("status", ["pending", "sending"])
      .maybeSingle();
    if (!existing.error && existing.data) {
      return { ok: true, job: existing.data as QueueJob, deduplicated: true };
    }
    return { ok: false, error: "duplicate enqueue race: retry" };
  }
  return { ok: false, error: "enqueue failed" };
}

/**
 * Sanctioned identity pattern: derive user_id from the server session's
 * single auth.getUser() (reuses the known user — no second lookup), then
 * enqueue. There is no path for a client-supplied user_id.
 */
export async function enqueueForAuthenticatedUser(
  sessionClient: Pick<SupabaseClient, "auth">,
  serviceClient: SupabaseClient,
  email: string,
): Promise<EnqueueResult> {
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  return enqueueVerificationEmail(serviceClient, { userId: user.id, email });
}

export async function claimJob(
  client: SupabaseClient,
  leaseOwner: string,
  leaseSeconds: number = LEASE_SECONDS_DEFAULT,
): Promise<{ job: QueueJob | null; error?: string }> {
  const { data, error } = await client.rpc("claim_email_verification_job", {
    p_lease_owner: leaseOwner,
    p_lease_seconds: leaseSeconds,
  });
  if (error) return { job: null, error: error.message.slice(0, 160) };
  const rows = data as QueueJob[] | QueueJob | null;
  const job = Array.isArray(rows) ? (rows[0] ?? null) : rows;
  return { job: job ?? null };
}

export async function expireSweep(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc("expire_email_verification_jobs");
  if (error) return -1;
  return typeof data === "number" ? data : -1;
}

export type ProcessOutcome =
  | { outcome: "sent"; job: QueueJob }
  | { outcome: "retry_scheduled"; job: QueueJob; retryAfterSeconds: number }
  | { outcome: "deferred_cooldown"; job: QueueJob; retryAt: string }
  | { outcome: "failed"; job: QueueJob }
  | { outcome: "expired"; job: QueueJob }
  | { outcome: "lease_lost"; jobId: string };

async function guardedFinalize(
  client: SupabaseClient,
  job: QueueJob,
  leaseOwner: string,
  patch: Record<string, unknown>,
): Promise<QueueJob | null> {
  const { data, error } = await client
    .from("email_verification_queue")
    .update({ ...patch, lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("lease_owner", leaseOwner)
    .eq("status", "sending")
    .select("*")
    .maybeSingle();
  if (error || !data) return null;
  return data as QueueJob;
}

async function readProviderCooldown(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.from("email_provider_state").select("cooldown_until").eq("provider", "brevo").maybeSingle();
  return (data as { cooldown_until: string | null } | null)?.cooldown_until ?? null;
}

async function writeProviderCooldown(client: SupabaseClient, cooldownUntil: string | null, bumpCounter: boolean): Promise<void> {
  const { data: prev } = await client
    .from("email_provider_state")
    .select("consecutive_rate_limits")
    .eq("provider", "brevo")
    .maybeSingle();
  const count = (prev as { consecutive_rate_limits: number } | null)?.consecutive_rate_limits ?? 0;
  await client.from("email_provider_state").upsert({
    provider: "brevo",
    cooldown_until: cooldownUntil,
    consecutive_rate_limits: bumpCounter ? count + 1 : 0,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Finalize one already-claimed job: expiry gate, cooldown gate, Brevo send
 * (outside any DB transaction), then a lease-guarded status update.
 */
export async function processClaimedJob(
  client: SupabaseClient,
  job: QueueJob,
  leaseOwner: string,
  sender: Sender,
  verificationUrl: string,
): Promise<ProcessOutcome> {
  const attempts = job.attempts + 1;

  // 1. Expiry is a pre-send gate: never send a lapsed item.
  if (Date.parse(job.expires_at) <= Date.now()) {
    const done = await guardedFinalize(client, job, leaseOwner, {
      status: "expired",
      attempts,
      last_error_category: "expired",
      last_error: "delivery window lapsed before send",
    });
    if (!done) return { outcome: "lease_lost", jobId: job.id };
    return { outcome: "expired", job: done };
  }

  // 2. Global provider cooldown: release back to pending at the cooldown
  //    horizon without burning an attempt or touching Brevo.
  const cooldownUntil = await readProviderCooldown(client);
  if (cooldownUntil && Date.parse(cooldownUntil) > Date.now()) {
    const done = await guardedFinalize(client, job, leaseOwner, {
      status: "pending",
      next_retry_at: cooldownUntil,
      last_error_category: "provider_cooldown",
      last_error: "deferred until provider cooldown elapses",
    });
    if (!done) return { outcome: "lease_lost", jobId: job.id };
    // attempts NOT incremented: no processing attempt occurred.
    return { outcome: "deferred_cooldown", job: { ...done, attempts: job.attempts }, retryAt: cooldownUntil };
  }

  // 3. Brevo call happens OUTSIDE any DB transaction.
  const result = await sender({ to: job.email, verificationUrl });

  // 4. Lease-guarded finalize.
  if (result.kind === "success") {
    await writeProviderCooldown(client, null, false);
    const done = await guardedFinalize(client, job, leaseOwner, {
      status: "sent",
      attempts,
      provider_message_id: result.providerMessageId || null,
      last_error_category: null,
      last_error: null,
    });
    if (!done) return { outcome: "lease_lost", jobId: job.id };
    return { outcome: "sent", job: done };
  }
  if (result.kind === "rate_limited" || result.kind === "quota_exhausted") {
    const retryAt = new Date(Date.now() + result.retryAfterSeconds * 1000).toISOString();
    await writeProviderCooldown(client, retryAt, true);
    const done = await guardedFinalize(client, job, leaseOwner, {
      status: "pending",
      attempts,
      next_retry_at: retryAt,
      last_error_category: result.kind === "rate_limited" ? "rate_limited" : "quota_exhausted",
      last_error:
        result.kind === "rate_limited"
          ? `brevo 429; retry after ${result.retryAfterSeconds}s`
          : `brevo quota exhausted; retry after ${result.retryAfterSeconds}s`,
    });
    if (!done) return { outcome: "lease_lost", jobId: job.id };
    return { outcome: "retry_scheduled", job: done, retryAfterSeconds: result.retryAfterSeconds };
  }
  if (result.kind === "permanent_failure" || result.kind === "config_error") {
    const done = await guardedFinalize(client, job, leaseOwner, {
      status: "failed",
      attempts,
      last_error_category: result.category.slice(0, 64),
      last_error: result.detail.slice(0, 200),
    });
    if (!done) return { outcome: "lease_lost", jobId: job.id };
    return { outcome: "failed", job: done };
  }
  // temporary_failure: bounded backoff, then fail rather than retry forever.
  if (attempts >= MAX_ATTEMPTS) {
    const done = await guardedFinalize(client, job, leaseOwner, {
      status: "failed",
      attempts,
      last_error_category: "max_attempts_exceeded",
      last_error: `${result.category.slice(0, 64)} after ${attempts} attempts`.slice(0, 200),
    });
    if (!done) return { outcome: "lease_lost", jobId: job.id };
    return { outcome: "failed", job: done };
  }
  const backoff = backoffSeconds(attempts);
  const done = await guardedFinalize(client, job, leaseOwner, {
    status: "pending",
    attempts,
    next_retry_at: new Date(Date.now() + backoff * 1000).toISOString(),
    last_error_category: result.category.slice(0, 64),
    last_error: result.detail.slice(0, 200),
  });
  if (!done) return { outcome: "lease_lost", jobId: job.id };
  return { outcome: "retry_scheduled", job: done, retryAfterSeconds: backoff };
}

export type RunOneResult = { claimed: false; reason: "empty_or_cooldown" } | { claimed: true; result: ProcessOutcome };

/** One worker tick: claim a single due job and process it to completion. */
export async function runOne(
  client: SupabaseClient,
  leaseOwner: string,
  sender: Sender,
  verificationUrl: string,
  leaseSeconds: number = LEASE_SECONDS_DEFAULT,
): Promise<RunOneResult> {
  const { job, error } = await claimJob(client, leaseOwner, leaseSeconds);
  if (error || !job) return { claimed: false, reason: "empty_or_cooldown" };
  const result = await processClaimedJob(client, job, leaseOwner, sender, verificationUrl);
  return { claimed: true, result };
}

export { sendVerificationEmail };
