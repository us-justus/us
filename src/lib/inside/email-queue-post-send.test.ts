import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getQueueSendState,
  getQueueRemaining,
  isQueueFullySent,
} from "./email-queue-send-state.ts";

/**
 * Step 5 follow-up: post-send UI state.
 *
 * The persisted queue summary is the ONLY source of truth for send
 * availability. Local React state (preparation, sendResult, clicked
 * flags) vanishes on refresh while the queue rows do not, so it must
 * never gate the SEND EMAIL action.
 */

const ROOT = new URL("../../../", import.meta.url);
const CLIENT = "src/app/inside/inside-client.tsx";
const STATE = "src/lib/inside/email-queue-send-state.ts";

function src(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8");
}

function code(body: string): string {
  return body
    .split("\n")
    .filter((line) => {
      const text = line.trim();
      return !text.startsWith("//") && !text.startsWith("*");
    })
    .join("\n");
}

function emailQueueSection(): string {
  const client = code(src(CLIENT));
  return client.slice(
    client.indexOf("function EmailQueuePanel()"),
    client.indexOf("/* ---------------- system health"),
  );
}

describe("post-send state logic — persisted summary is the source of truth", () => {
  it("fully sent queue reports sent with nothing left to send", () => {
    // The staging result: 2 attempted, 2 sent, 0 failed, 0 skipped.
    assert.equal(
      getQueueSendState({ pending: 0, sending: 0, sent: 2, failed: 0 }),
      "sent",
    );
    assert.equal(getQueueRemaining({ pending: 0, sent: 2 }), 0);
    assert.equal(
      isQueueFullySent({ pending: 0, sending: 0, sent: 2, failed: 0 }),
      true,
    );
  });

  it("fully sent state survives a reload (no local state required)", () => {
    // After a browser refresh preparation/sendResult are null; the same
    // persisted summary must still resolve to sent without any local
    // React state beyond the summary itself.
    const persisted = { pending: 0, sending: 0, sent: 2, failed: 0 };
    assert.equal(getQueueSendState(persisted), "sent");
    assert.equal(getQueueSendState(persisted, { isSending: false }), "sent");
    assert.equal(isQueueFullySent(persisted), true);
  });

  it("sent plus terminal skips is complete, not a generic send", () => {
    assert.equal(
      getQueueSendState({
        pending: 0,
        sending: 0,
        sent: 1,
        failed: 0,
        skippedQueue: 1,
      }),
      "sent",
    );
  });

  it("partial failure reports retry, never a generic resend", () => {
    assert.equal(
      getQueueSendState({ pending: 0, sending: 0, sent: 1, failed: 1 }),
      "retry",
    );
    assert.equal(
      isQueueFullySent({ pending: 0, sent: 1, failed: 1 }),
      false,
    );
  });

  it("unsent recipients keep the send action available", () => {
    assert.equal(
      getQueueSendState({ pending: 2, sending: 0, sent: 0, failed: 0 }),
      "send",
    );
    assert.equal(getQueueRemaining({ pending: 2, sending: 1 }), 3);
    // Pending plus failed mix still offers the send path (the send route
    // itself narrows to PENDING + retryable FAILED + stale SENDING, so
    // SENT rows are never candidates).
    assert.equal(
      getQueueSendState({ pending: 1, sent: 1, failed: 1 }),
      "send",
    );
  });

  it("in-flight send reports sending without touching queue semantics", () => {
    assert.equal(
      getQueueSendState(
        { pending: 2, sent: 0, failed: 0 },
        { isSending: true },
      ),
      "sending",
    );
  });

  it("empty and unknown summaries never claim a sent state", () => {
    assert.equal(getQueueSendState(null), "unknown");
    assert.equal(getQueueSendState(undefined), "unknown");
    assert.equal(
      getQueueSendState({ pending: 0, sent: 0, failed: 0 }),
      "empty",
    );
    assert.equal(isQueueFullySent(null), false);
    assert.equal(isQueueFullySent({ pending: 0, sent: 0 }), false);
  });

  it("negative or missing counts degrade to zero, never to sendable", () => {
    assert.equal(getQueueRemaining(null), 0);
    assert.equal(getQueueRemaining({}), 0);
  });
});

describe("post-send UI — fully sent hides the send action", () => {
  it("derives send availability from the persisted summary, not local state", () => {
    const section = emailQueueSection();
    assert.ok(
      section.includes("getQueueSendState(summary"),
      "send availability must derive from the persisted summary",
    );
    assert.ok(
      !section.includes("clickedSend"),
      "no click-flag may gate sending",
    );
  });

  it("fully sent renders a completed state with no send action", () => {
    const section = emailQueueSection();
    assert.ok(section.includes("queueFullySent"), "fully-sent gate must exist");
    assert.ok(
      section.includes("This prepared email has been sent."),
      "completed state must say the email was sent",
    );
    assert.ok(
      section.includes("✓ Email sent."),
      "completed state must be unmistakable",
    );
    // The completed branches offer no send control: slice the first
    // fully-sent box and confirm it cannot trigger a send.
    const firstBox = section.indexOf("✓ Email sent.");
    assert.ok(firstBox >= 0);
    const boxSlice = section.slice(firstBox, firstBox + 1200);
    assert.ok(!boxSlice.includes("sendQueue()"), "completed state never sends");
    assert.ok(
      !boxSlice.includes('aria-label="send email"'),
      "completed state has no SEND EMAIL action",
    );
  });

  it("subject and message become read-only once fully sent", () => {
    const section = emailQueueSection();
    assert.ok(section.includes("sendFormLocked"), "locked form flag must exist");
    assert.ok(
      section.includes("readOnly={sendFormLocked}"),
      "subject/message must be read-only once sent",
    );
  });

  it("pre-send copy no longer claims nothing was sent after a send", () => {
    const section = emailQueueSection();
    const i = section.indexOf("No emails have been sent.");
    assert.ok(i >= 0, "pre-send copy is preserved for genuinely unsent queues");
    const gate = section.lastIndexOf("queueSent === 0", i);
    assert.ok(
      gate >= 0 && i - gate < 400,
      "pre-send copy must be gated on the persisted sent count",
    );
  });

  it("refresh-safe persisted block survives without local preparation", () => {
    const section = emailQueueSection();
    assert.ok(
      section.includes("!preparation && !loading && summary"),
      "a persisted block must render after refresh with no local preparation",
    );
    assert.ok(
      section.includes("persistedShowSent"),
      "persisted block must cover the fully-sent state",
    );
    assert.ok(
      section.includes("last prepared:"),
      "persisted block keeps a durable timestamp",
    );
  });
});

describe("post-send UI — partial failure and skipped rows", () => {
  it("partial failure offers retry failed, never a generic resend", () => {
    const section = emailQueueSection();
    assert.ok(section.includes("queueNeedsRetry"), "retry gate must exist");
    assert.ok(
      section.includes('aria-label="retry failed"'),
      "retry action must be explicit",
    );
    assert.ok(
      section.includes("Email partially sent."),
      "partial wording must be explicit",
    );
    assert.ok(
      /already-sent[\s\S]{0,80}never sent again/i.test(section),
      "retry copy must promise SENT rows are never resent",
    );
  });

  it("retry-after-refresh keeps subject/message controls separate from history", () => {
    const section = emailQueueSection();
    assert.ok(section.includes("persistedShowRetry"), "refresh-safe retry must exist");
    assert.ok(
      section.includes("waitlist-retry-subject"),
      "retry after refresh has its own subject control",
    );
    assert.ok(
      section.includes("waitlist-retry-body"),
      "retry after refresh has its own message control",
    );
  });

  it("skipped recipients are reported, never re-armed as sendable", () => {
    const section = emailQueueSection();
    assert.ok(
      section.includes("queueSkipped"),
      "durable skipped count must be surfaced",
    );
    const box = section.indexOf("queueSkipped");
    assert.ok(box >= 0);
  });

  it("Step 4 prepare behavior is unchanged", () => {
    const section = emailQueueSection();
    assert.ok(section.includes("prepare email"), "prepare action preserved");
    assert.ok(
      section.includes('fetch("/api/inside/email-queue", { method: "POST" })'),
      "prepare still posts to the preparation endpoint",
    );
    assert.ok(section.includes("preparation.uniqueRecipientCount"), "bounded preparation count still rendered");
    assert.ok(!section.includes("preparation.recipients.map((email)"), "recipient addresses stay server-side");
    assert.ok(section.includes("preview"), "preview preserved");
  });

  it("helper stays free of sender, audience, and launch machinery", () => {
    const body = code(src(STATE));
    assert.ok(!/brevo|smtp|sendWaitlistEmail/i.test(body), "no provider touch");
    assert.ok(!/launch|campaign/i.test(body), "no launch/campaign logic");
    assert.ok(
      !/supabase|createClient|fetch\(/i.test(body),
      "pure derivation only — no I/O",
    );
  });
});
