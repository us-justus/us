/**
 * Persisted post-send UI state for the /inside waitlist email queue.
 *
 * The persisted queue summary (GET /api/inside/email-queue) is the ONLY
 * source of truth for whether sending is available. Local React state
 * (preparation, sendResult, clicked flags) must never re-enable sending
 * after a refresh — it vanishes on reload while the queue rows do not.
 *
 * Queue semantics (unchanged, see the send route + send migration):
 * - `remaining` (server) = PENDING + SENDING rows. SENT rows are never
 *   candidates; only PENDING, stale SENDING, and retryable temporary
 *   FAILED rows are attempted. SKIPPED and permanent FAILED rows are
 *   terminal.
 * - The summary exposes durable counts: pending, sending, sent, failed,
 *   skippedQueue. It does not split FAILED into retryable vs terminal,
 *   so any failed > 0 with nothing pending is surfaced as an explicit
 *   RETRY FAILED action — the send route itself filters to retryable
 *   rows, so already-SENT rows can never be resent.
 */

export type QueueSendCounts = {
  pending?: number | null;
  sending?: number | null;
  sent?: number | null;
  failed?: number | null;
  skippedQueue?: number | null;
};

/** Persisted send availability derived ONLY from durable queue counts. */
export type QueueSendState =
  | "unknown"
  | "empty"
  | "send"
  | "sending"
  | "retry"
  | "sent";

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function hasQueue(counts: QueueSendCounts): boolean {
  return (
    count(counts.pending) +
      count(counts.sending) +
      count(counts.sent) +
      count(counts.failed) +
      count(counts.skippedQueue) >
    0
  );
}

/**
 * Derive the persisted send state. `isSending` is the transient
 * in-flight flag for the current send request only — it never marks
 * rows as sent and never survives a refresh.
 */
export function getQueueSendState(
  summary: QueueSendCounts | null | undefined,
  opts?: { isSending?: boolean; lastPreparedAt?: string | null },
): QueueSendState {
  if (!summary) return "unknown";
  if (opts?.isSending) return "sending";
  const pending = count(summary.pending);
  const sending = count(summary.sending);
  const sent = count(summary.sent);
  const failed = count(summary.failed);
  const remaining = pending + sending;
  if (remaining > 0) return "send";
  if (failed > 0) return "retry";
  if (sent > 0) return "sent";
  if (hasQueue(summary)) return "sent";
  if (opts?.lastPreparedAt) return "sent";
  return "empty";
}

/** True only when every eligible recipient is durably sent. */
export function isQueueFullySent(
  summary: QueueSendCounts | null | undefined,
): boolean {
  if (!summary) return false;
  return getQueueSendState(summary) === "sent";
}

/** Persisted remaining = PENDING + SENDING (mirrors the send route). */
export function getQueueRemaining(
  summary: QueueSendCounts | null | undefined,
): number {
  if (!summary) return 0;
  return count(summary.pending) + count(summary.sending);
}
