import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isUnconfirmedSending,
  runEmailQueueSend,
  selectSendCandidates,
  type QueueSendRow,
  type QueueSendStore,
} from "./email-queue-send-runner.ts";

function row(overrides: Partial<QueueSendRow> = {}): QueueSendRow {
  return {
    id: "row-1",
    user_id: "user-1",
    email: "student@example.com",
    status: "PENDING",
    attempts: 0,
    next_attempt_at: null,
    updated_at: new Date(0).toISOString(),
    last_error: null,
    ...overrides,
  };
}

function store(overrides: Partial<QueueSendStore> = {}): QueueSendStore {
  return {
    claim: async () => true,
    eligibility: async () => null,
    settleSkip: async () => true,
    releaseConfig: async () => true,
    settleSent: async () => true,
    settleFailed: async () => true,
    markUnconfirmed: async () => true,
    ...overrides,
  };
}

describe("email-queue send runner — candidate selection", () => {
  const now = 1_000_000_000_000;

  it("selects PENDING, stale SENDING, and due retryable FAILED only", () => {
    const rows = [
      row({ id: "pending", status: "PENDING" }),
      row({
        id: "stale",
        status: "SENDING",
        updated_at: new Date(now - 11 * 60 * 1000).toISOString(),
      }),
      row({
        id: "retry",
        status: "FAILED",
        last_error: "temporary: 500",
        next_attempt_at: new Date(now - 1).toISOString(),
      }),
      row({
        id: "future",
        status: "FAILED",
        last_error: "temporary: 500",
        next_attempt_at: new Date(now + 60_000).toISOString(),
      }),
      row({ id: "skipped", status: "SKIPPED" }),
      row({ id: "sent", status: "SENT" }),
      row({ id: "permanent", status: "FAILED", last_error: "permanent: 422" }),
    ];
    assert.deepEqual(
      selectSendCandidates(rows, now).map((r) => r.id),
      ["pending", "stale", "retry"],
    );
  });

  it("never reclaims an UNCONFIRMED SENDING row", () => {
    const unconfirmed = row({
      id: "unconfirmed",
      status: "SENDING",
      updated_at: new Date(now - 60 * 60 * 1000).toISOString(),
      last_error: "unconfirmed: provider accepted but SENT update failed",
    });
    assert.equal(isUnconfirmedSending(unconfirmed), true);
    assert.deepEqual(selectSendCandidates([unconfirmed], now), []);
  });
});

describe("email-queue send runner — persisted failure accounting", () => {
  it("does not count a claim that lost the race", async () => {
    let sent = 0;
    const counts = await runEmailQueueSend({
      rows: [row()],
      store: store({ claim: async () => false }),
      send: async () => {
        sent += 1;
        return { kind: "success", providerMessageId: "p" };
      },
    });
    assert.deepEqual(counts, {
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      unrecorded: 0,
    });
    assert.equal(sent, 0);
  });

  it("does not count SKIPPED when the skip update fails", async () => {
    const counts = await runEmailQueueSend({
      rows: [row()],
      store: store({
        eligibility: async () => "profile suspended",
        settleSkip: async () => false,
      }),
      send: async () => {
        throw new Error("must not send");
      },
    });
    assert.equal(counts.attempted, 1);
    assert.equal(counts.skipped, 0);
    assert.equal(counts.unrecorded, 1);
  });

  it("does not count SENT when the SENT update fails, and marks unconfirmed", async () => {
    let marked = "";
    const counts = await runEmailQueueSend({
      rows: [row()],
      store: store({
        settleSent: async () => false,
        markUnconfirmed: async (_row, detail) => {
          marked = detail;
          return true;
        },
      }),
      send: async () => ({ kind: "success", providerMessageId: "p" }),
    });
    assert.equal(counts.sent, 0);
    assert.equal(counts.unrecorded, 1);
    assert.match(marked, /^unconfirmed:/);
  });

  it("does not count FAILED when the FAILED update fails", async () => {
    const counts = await runEmailQueueSend({
      rows: [row()],
      store: store({ settleFailed: async () => false }),
      send: async () => ({ kind: "temporary_failure", detail: "timeout" }),
    });
    assert.equal(counts.failed, 0);
    assert.equal(counts.unrecorded, 1);
  });

  it("undoes the attempt when a config release persists", async () => {
    let secondSent = false;
    const counts = await runEmailQueueSend({
      rows: [row({ id: "a" }), row({ id: "b" })],
      store: store({ releaseConfig: async () => true }),
      send: async (r) => {
        if (r.id === "b") secondSent = true;
        return { kind: "config_error", detail: "missing" };
      },
    });
    assert.equal(counts.attempted, 0);
    assert.equal(counts.unrecorded, 0);
    assert.equal(secondSent, false);
  });

  it("reports a persisted success", async () => {
    const counts = await runEmailQueueSend({
      rows: [row()],
      store: store(),
      send: async () => ({ kind: "success", providerMessageId: "p" }),
    });
    assert.deepEqual(counts, {
      attempted: 1,
      sent: 1,
      failed: 0,
      skipped: 0,
      unrecorded: 0,
    });
  });
});
