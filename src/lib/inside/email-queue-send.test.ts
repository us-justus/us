import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

/**
 * Step 5 static guards: the explicit prepared-queue send operation.
 *
 * Preparation never sends (guarded by email-queue.test.ts); THESE tests
 * guard the inverse — only the explicit confirmed send path may reach
 * Brevo, with race-safe claims, eligibility re-checks, durable outcomes,
 * aggregate-only auditing, and no launch/campaign machinery.
 */

const ROOT = new URL("../../../", import.meta.url);
const SEND_MIGRATION = "supabase/migrations/20261018000001_waitlist_email_send.sql";
const PREPARE_MIGRATION = "supabase/migrations/20261017000001_email_queue_audience_consistency.sql";
const SEND_ROUTE = "src/app/api/inside/email-queue/send/route.ts";
const SEND_RUNNER = "src/lib/inside/email-queue-send-runner.ts";
const PREPARE_ROUTE = "src/app/api/inside/email-queue/route.ts";
const SENDER = "src/lib/inside/waitlist-email.ts";
const CLIENT = "src/app/inside/inside-client.tsx";
const AUDIT = "src/lib/inside/audit.ts";

function src(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8");
}

function code(body: string): string {
  return body
    .split("\n")
    .filter((line) => {
      const text = line.trim();
      return !text.startsWith("//") && !text.startsWith("*") && !text.startsWith("--");
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

describe("waitlist send — migration discipline", () => {
  it("lives in a new uniquely-timestamped migration; applied migrations untouched", () => {
    assert.ok(existsSync(new URL(SEND_MIGRATION, ROOT)), "send migration must exist");
    const prior = code(src(PREPARE_MIGRATION));
    assert.ok(!prior.includes("SENDING"), "applied Step 4 migration must not gain SENDING");
    assert.ok(!prior.includes("SKIPPED"), "applied Step 4 migration must not gain SKIPPED");
    assert.ok(!prior.includes("WAITLIST_EMAIL_SENT"), "applied Step 4 migration must not gain the send audit action");
  });

  it("widens the status lifecycle without new tables or audience changes", () => {
    const migration = code(src(SEND_MIGRATION));
    for (const status of ["PENDING", "SENDING", "SENT", "FAILED", "SKIPPED"]) {
      assert.ok(migration.includes(`'${status}'`), `lifecycle must include ${status}`);
    }
    assert.ok(migration.includes("waitlist_email_queue_status_check"), "must rewrite the status CHECK");
    assert.ok(!/create\s+table/i.test(migration), "no new tables (no campaigns/templates systems)");
    assert.ok(!/waitlist_email_eligible_students\(\)\s*\)\s*language/i.test(migration), "must not redefine the audience function");
    assert.equal(
      (migration.match(/waitlist_email_eligible_students\(\)/g) ?? []).length,
      1,
      "the summary must still resolve the source audience once",
    );
  });

  it("summary keeps every Step 4 field and adds durable send states", () => {
    const migration = code(src(SEND_MIGRATION));
    for (const field of [
      "waitingStudentCount",
      "uniqueRecipientCount",
      "skippedCount",
      "students",
      "pending",
      "sent",
      "failed",
      "lastPreparedAt",
    ]) {
      assert.ok(migration.includes(`'${field}'`), `summary keeps ${field}`);
    }
    assert.ok(migration.includes("'sending'"), "summary exposes sending");
    assert.ok(migration.includes("'skippedQueue'"), "summary exposes skippedQueue");
    assert.ok(migration.includes("if not public.is_admin() then"), "summary keeps the admin gate");
  });

  it("audit CHECK gains only WAITLIST_EMAIL_SENT on top of permanent actions", () => {
    const migration = code(src(SEND_MIGRATION));
    const i = migration.indexOf("add constraint inside_audit_events_action_check");
    assert.ok(i >= 0, "must extend the active audit CHECK");
    const block = migration.slice(i, i + 800);
    for (const action of [
      "ADMIN_LOGIN_SUCCESS",
      "ADMIN_LOGIN_FAILURE",
      "ADMIN_LOGOUT",
      "STUDENT_SUSPENDED",
      "STUDENT_RESTORED",
      "REPORT_RESOLVED",
      "FEEDBACK_REPLIED",
      "FEEDBACK_RESOLVED",
      "WAITLIST_EMAIL_QUEUE_PREPARED",
      "WAITLIST_EMAIL_SENT",
    ]) {
      assert.ok(block.includes(`'${action}'`), `CHECK must allow ${action}`);
    }
  });

  it("migration adds no sender, provider call, launch, or campaign machinery", () => {
    const migration = code(src(SEND_MIGRATION));
    assert.ok(!/brevo|smtp|api\.brevo\.com/i.test(migration), "no provider calls in SQL");
    assert.ok(!/launch|campaign|template|segment|schedul|newsletter|broadcast/i.test(migration), "no launch/campaign systems");
  });
});

describe("waitlist send — Brevo sender library", () => {
  it("is server-only and reuses the Brevo sender configuration", () => {
    assert.ok(existsSync(new URL(SENDER, ROOT)), "sender module must exist");
    const body = code(src(SENDER));
    assert.ok(body.includes('typeof window !== "undefined"'), "must refuse client execution");
    assert.ok(body.includes("process.env.BREVO_API_KEY"), "reads the shared API key server-side");
    assert.ok(body.includes("process.env.BREVO_SENDER_EMAIL"), "reads the shared sender email");
    assert.ok(body.includes("process.env.BREVO_SENDER_NAME"), "reads the shared sender name");
    assert.ok(body.includes("https://api.brevo.com/v3/smtp/email"), "uses the existing Brevo endpoint");
    assert.ok(!body.includes("NEXT_PUBLIC"), "no client-exposed credentials");
  });

  it("validates subject and message server-side with header-injection protection", () => {
    const body = code(src(SENDER));
    assert.ok(body.includes("validateWaitlistEmailContent"), "exports a content validator");
    assert.ok(body.includes("WAITLIST_SUBJECT_MAX"), "subject has a maximum length");
    assert.ok(body.includes("WAITLIST_MESSAGE_MAX"), "message has a maximum length");
    assert.ok(/\[\\r\\n\]|\\r|\\n/.test(body), "subject rejects CR/LF header injection");
  });

  it("uses an explicit timeout and classifies provider outcomes", () => {
    const body = code(src(SENDER));
    assert.ok(body.includes("AbortController"), "explicit request timeout required");
    assert.ok(body.includes("WAITLIST_BREVO_TIMEOUT_MS"), "timeout is a named constant");
    assert.ok(body.includes('"success"'), "success carries the provider message id");
    assert.ok(body.includes("providerMessageId"), "provider message id is returned");
    assert.ok(body.includes('"config_error"'), "401/403 or missing config is distinct");
    assert.ok(body.includes('"permanent_failure"'), "4xx rejections are permanent");
    assert.ok(body.includes('"temporary_failure"'), "5xx/network/timeout is retryable");
    assert.ok(body.includes("timed out"), "timeouts map to temporary failures");
  });
});

describe("waitlist send — explicit route authorization and content", () => {
  it("requires the admin gate plus origin protection and validates content", () => {
    assert.ok(existsSync(new URL(SEND_ROUTE, ROOT)), "send route must exist");
    const body = code(src(SEND_ROUTE));
    assert.ok(body.includes("requireInsideAdmin()"), "admin gate required");
    assert.ok(body.includes("verifySameOrigin(req)"), "origin protection required");
    assert.ok(body.includes("validateWaitlistEmailContent(subject, message)"), "server-side content validation");
    assert.ok(body.includes("status: 403"), "rejects non-admin callers");
    assert.ok(body.includes("status: 400"), "rejects empty/oversized content");
  });

  it("trusts no client-supplied recipient data", () => {
    const body = code(src(SEND_ROUTE));
    assert.ok(body.includes("waitlist_email_queue"), "recipients come from the persisted queue");
    assert.ok(!/recipient_email|student_id|admin_id/i.test(body), "no client-supplied recipient identity");
    const parsed = body.slice(body.indexOf("req.json()"));
    assert.ok(!parsed.includes("recipients") || parsed.includes("preparation"), "request body carries content only");
  });

  it("GET never sends", () => {
    const body = code(src(SEND_ROUTE));
    assert.ok(/export async function GET/.test(body), "GET is explicitly handled");
    const getBlock = body.slice(body.indexOf("export async function GET"), body.indexOf("export async function POST"));
    assert.ok(getBlock.includes("405"), "GET is rejected without sending");
    assert.ok(!/sendWaitlistEmail/.test(getBlock), "GET path never reaches Brevo");
  });

  it("leaves the prepare route a non-sending operation", () => {
    const body = code(src(PREPARE_ROUTE));
    assert.ok(!/brevo|smtp|sendWaitlistEmail|api\.brevo\.com/i.test(body), "prepare must never call the provider");
  });
});

describe("waitlist send — eligibility re-check and snapshot discipline", () => {
  it("re-checks live eligibility before every delivery", () => {
    const body = code(src(SEND_ROUTE));
    assert.ok(body.includes('from("profiles")'), "profile must still exist");
    assert.ok(body.includes("is_active"), "suspension is re-checked");
    assert.ok(body.includes('from("profile_photos")'), "photo-completeness is re-checked");
    assert.ok(body.includes('from("verification_records")'), "current email is re-checked");
  });

  it("never substitutes a changed email; ineligible rows are durably skipped", () => {
    const body = code(src(SEND_ROUTE));
    assert.ok(body.includes("current !== row.email"), "snapshot email must equal the current email");
    assert.ok(body.includes('"SKIPPED"'), "ineligible recipients become SKIPPED");
    assert.ok(body.includes("last_error"), "skip reasons persist durably");
    for (const reason of ["profile missing", "profile suspended", "photo incomplete", "email invalid", "email changed"]) {
      assert.ok(body.includes(reason), `skip reason recorded: ${reason}`);
    }
    assert.ok(!/update\(\{\s*email/i.test(body), "the snapshot email is never rewritten");
  });
});

describe("waitlist send — race-safe idempotency and partial failure", () => {
  it("claims rows atomically before any provider call", () => {
    const body = code(src(SEND_ROUTE));
    const claimAt = body.indexOf('status: "SENDING"');
    const sendAt = body.indexOf("sendWaitlistEmail({");
    assert.ok(claimAt >= 0 && sendAt >= 0 && claimAt < sendAt, "claim must precede the Brevo call");
    assert.ok(body.includes('.eq("status", row.status)'), "claim is guarded by the prior status");
    assert.ok(body.includes('.eq("updated_at", row.updated_at)'), "claim is guarded against concurrent claims");
    assert.ok(body.includes("attempts: row.attempts + 1"), "attempts track each claim");
  });

  it("never resends SENT rows and never rolls back successes", () => {
    const body = code(src(SEND_ROUTE));
    const runner = code(src(SEND_RUNNER));
    assert.ok(body.includes('["PENDING", "SENDING", "FAILED"]'), "SENT rows are never candidates");
    assert.ok(runner.includes("isRetryableFailed"), "only temporary FAILED rows are retryable");
    assert.ok(runner.includes("isStaleSending"), "stale SENDING claims recover crashes");
    assert.ok(runner.includes("isUnconfirmedSending"), "unconfirmed provider successes are excluded");
    assert.ok(!/rollback/i.test(body), "successful sends are never rolled back");
    assert.ok(body.includes('.eq("status", "SENDING")'), "final transitions only leave SENDING");
  });

  it("persists provider outcomes per recipient with structured counts", () => {
    const body = code(src(SEND_ROUTE));
    assert.ok(body.includes("provider_message_id"), "provider message id persisted on success");
    assert.ok(body.includes("sent_at"), "sent_at persisted on success");
    assert.ok(body.includes('"SENT"'), "success becomes SENT");
    assert.ok(body.includes('"FAILED"'), "provider/network/timeout failures become FAILED");
    assert.ok(body.includes("temporary:"), "temporary failures stay retryable with backoff");
    assert.ok(body.includes("permanent:"), "permanent rejections are terminal");
    assert.ok(body.includes("attempted") && body.includes("remaining"), "result reports attempted and remaining");
    assert.ok(body.includes("unrecorded"), "result reports unpersisted terminal updates");
  });
});

describe("waitlist send — audit hygiene", () => {
  it("records aggregate counts with no addresses or content", () => {
    const body = code(src(SEND_ROUTE));
    assert.ok(body.includes('recordInsideAuditEvent("WAITLIST_EMAIL_SENT"'), "send is audited");
    const auditAt = body.indexOf('recordInsideAuditEvent("WAITLIST_EMAIL_SENT"');
    const auditBlock = body.slice(auditAt, auditAt + 400);
    for (const field of ["attempted", "sent", "failed", "skipped", "unrecorded"]) {
      assert.ok(auditBlock.includes(field), `audit metadata has ${field}`);
    }
    // Scope to the metadata object literal: only aggregate counters may
    // appear there (the surrounding log line legitimately names email).
    const metaAt = auditBlock.indexOf("metadata:");
    assert.ok(metaAt >= 0, "audit passes a metadata object");
    const metaEnd = auditBlock.indexOf("}", metaAt);
    assert.ok(metaEnd > metaAt, "metadata object must close");
    const metaBlock = auditBlock.slice(metaAt, metaEnd);
    assert.ok(!/subject|message|address|recipient|email/i.test(metaBlock), "audit metadata carries no content or addresses");
    assert.ok(!/api[-_ ]?key|BREVO_API_KEY/i.test(metaBlock), "audit metadata carries no secrets");
  });

  it("helper action set includes the send action and no launch actions", () => {
    const body = code(src(AUDIT));
    assert.ok(body.includes('"WAITLIST_EMAIL_SENT"'), "helper allows the send action");
    for (const action of ["LAUNCH_ENABLED", "LAUNCH_DISABLED", "LAUNCH_VERSION_CHANGED"]) {
      assert.ok(!body.includes(action), `no launch action: ${action}`);
    }
  });
});

describe("waitlist send — confirmation UX", () => {
  it("keeps prepare and send visually and semantically separate", () => {
    const section = emailQueueSection();
    assert.ok(section.includes('fetch("/api/inside/email-queue/send"'), "explicit send endpoint is called");
    assert.ok(section.includes("Send this email?"), "confirmation opens before any send");
    assert.ok(section.includes("This will send a real email"), "confirmation states the real-world effect");
    assert.ok(section.includes("cancel"), "confirmation offers an exit");
    assert.ok(section.includes("send email"), "final action is explicitly labelled");
    assert.ok(section.includes("prepare email"), "prepare action is preserved distinctly");
  });

  it("disables duplicate sends, shows progress, and reports durable results", () => {
    const section = emailQueueSection();
    assert.ok(section.includes("sending…"), "sending state is shown");
    assert.ok(section.includes("disabled={sending"), "duplicate sends are disabled");
    assert.ok(section.includes("Email sent."), "full success is reported");
    assert.ok(section.includes("Email partially sent."), "partial success is reported");
    for (const field of ["attempted", "sent", "failed", "skipped", "unrecorded", "remaining"]) {
      assert.ok(section.includes(`sendResult.${field}`), `result shows ${field}`);
    }
  });

  it("preserves prepare idempotency cues, editing, and preview with no provider touch", () => {
    const section = emailQueueSection();
    assert.ok(section.includes("preparation.recipients.map((email)"), "server snapshot still rendered");
    assert.ok(section.includes("No emails have been sent."), "pre-send state is explicit");
    assert.ok(section.includes("waitlist-subject") && section.includes("waitlist-body"), "subject/message stay editable");
    assert.ok(section.includes("preview"), "preview is preserved");
    assert.ok(!/sendWaitlistEmail|api\.brevo\.com/i.test(section), "the browser never touches the provider");
    assert.ok(!/>\s*send\s*</i.test(section), "no bare send control may exist");
  });
});

describe("waitlist send — regressions", () => {
  it("existing verification and feedback senders are untouched", () => {
    assert.ok(src("src/lib/feedback/reply-email.ts").includes("sendFeedbackReplyEmail"));
    assert.ok(src("src/lib/email-verification/brevo.ts").includes("sendVerificationEmail"));
  });

  it("introduces no launch, campaign, scheduling, or worker machinery", () => {
    for (const rel of [SEND_ROUTE, SENDER, SEND_MIGRATION]) {
      const body = code(src(rel));
      assert.ok(!/launch_config|admin_set_launch|getLaunchState|guardLaunch/i.test(body), `no launch in ${rel}`);
      assert.ok(!/campaign|newsletter|broadcast|segment|setInterval/i.test(body), `no campaign/worker in ${rel}`);
    }
    assert.ok(!/create\s+table/i.test(code(src(SEND_MIGRATION))), "no new tables");
    // The only timer in the sender is the explicit Brevo request timeout.
    assert.ok(code(src(SENDER)).includes("controller.abort()"), "timeout only guards the provider request");
  });
});
