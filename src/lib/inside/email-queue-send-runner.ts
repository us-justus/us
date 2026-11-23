/**
 * Pure orchestration for the explicit waitlist-email send (F-13).
 *
 * Kept free of Supabase/Next imports so failure and concurrency accounting
 * can be unit-tested with deterministic fakes. The route supplies the
 * persistence store and Brevo sender.
 *
 * Counters reflect PERSISTED outcomes only:
 *   - attempted increments only after a race-safe claim persists;
 *   - skipped/sent/failed increment only when their status update persists;
 *   - unrecorded counts claimed rows whose terminal update did not persist.
 * A successful provider call whose SENT update fails is best-effort marked
 * UNCONFIRMED (status stays SENDING + last_error marker) so stale-SENDING
 * recovery cannot resend it automatically.
 */

export type QueueSendRow = {
  id: string;
  user_id: string | null;
  email: string;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
  updated_at: string;
  last_error: string | null;
};

export type QueueSendOutcome =
  | { kind: "success"; providerMessageId: string }
  | { kind: "config_error"; detail: string }
  | { kind: "permanent_failure"; detail: string }
  | { kind: "temporary_failure"; detail: string; ambiguous?: boolean };

export type QueueSendStore = {
  claim(row: QueueSendRow): Promise<boolean>;
  /** null when eligible, otherwise the durable skip reason. */
  eligibility(row: QueueSendRow): Promise<string | null>;
  settleSkip(row: QueueSendRow, reason: string): Promise<boolean>;
  releaseConfig(row: QueueSendRow): Promise<boolean>;
  settleSent(row: QueueSendRow, providerMessageId: string | null): Promise<boolean>;
  settleFailed(
    row: QueueSendRow,
    permanent: boolean,
    detail: string,
  ): Promise<boolean>;
  markUnconfirmed(row: QueueSendRow, detail: string): Promise<boolean>;
};

export type QueueSendDeps = {
  rows: QueueSendRow[];
  store: QueueSendStore;
  send(row: QueueSendRow): Promise<QueueSendOutcome>;
  now?: number;
};

export type QueueSendCounts = {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  unrecorded: number;
  unconfirmed: number;
};

export const STALE_SENDING_MS = 10 * 60 * 1000;
export const TEMPORARY_RETRY_MS = 5 * 60 * 1000;
const UNCONFIRMED_MARKER = "unconfirmed:";

export function isRetryableFailed(row: QueueSendRow, now: number): boolean {
  if (row.status !== "FAILED") return false;
  if (!row.last_error || !row.last_error.startsWith("temporary:")) return false;
  if (!row.next_attempt_at) return true;
  const due = Date.parse(row.next_attempt_at);
  if (Number.isNaN(due)) return true;
  return due <= now;
}

/** A SENT update that failed after provider success must never be retried. */
export function isUnconfirmedSending(row: QueueSendRow): boolean {
  return (
    row.status === "SENDING" &&
    typeof row.last_error === "string" &&
    row.last_error.startsWith(UNCONFIRMED_MARKER)
  );
}

export function isStaleSending(row: QueueSendRow, now: number): boolean {
  if (row.status !== "SENDING") return false;
  if (isUnconfirmedSending(row)) return false;
  const updated = Date.parse(row.updated_at);
  if (Number.isNaN(updated)) return true;
  return now - updated >= STALE_SENDING_MS;
}

export function selectSendCandidates(
  rows: QueueSendRow[],
  now: number,
): QueueSendRow[] {
  return rows.filter(
    (row) =>
      row.status === "PENDING" ||
      isRetryableFailed(row, now) ||
      isStaleSending(row, now),
  );
}

export async function runEmailQueueSend(
  deps: QueueSendDeps,
): Promise<QueueSendCounts> {
  const now = deps.now ?? Date.now();
  const counts: QueueSendCounts = {
    attempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    unrecorded: 0,
    unconfirmed: 0,
  };

  for (const row of selectSendCandidates(deps.rows, now)) {
    if (!(await deps.store.claim(row))) continue;
    counts.attempted += 1;

    const skipReason = await deps.store.eligibility(row);
    if (skipReason) {
      if (await deps.store.settleSkip(row, skipReason)) {
        counts.skipped += 1;
      } else {
        counts.unrecorded += 1;
      }
      continue;
    }

    const outcome = await deps.send(row);
    if (outcome.kind === "success") {
      if (
        await deps.store.settleSent(row, outcome.providerMessageId || null)
      ) {
        counts.sent += 1;
      } else {
        counts.unrecorded += 1;
        await deps.store.markUnconfirmed(
          row,
          "unconfirmed: provider accepted but SENT update failed",
        );
      }
      continue;
    }

    if (outcome.kind === "config_error") {
      // Configuration flipped mid-batch: release the claim so the row stays
      // retryable and stop. The claim is only undone if the release persisted.
      if (await deps.store.releaseConfig(row)) {
        counts.attempted -= 1;
      } else {
        counts.unrecorded += 1;
      }
      break;
    }

    const permanent = outcome.kind === "permanent_failure";
    if (outcome.kind === "temporary_failure" && outcome.ambiguous) {
      if (await deps.store.markUnconfirmed(row, `unconfirmed: ${outcome.detail}`)) {
        counts.unconfirmed += 1;
      } else {
        counts.unrecorded += 1;
      }
      continue;
    }
    if (await deps.store.settleFailed(row, permanent, outcome.detail)) {
      counts.failed += 1;
    } else {
      counts.unrecorded += 1;
    }
  }

  return counts;
}
