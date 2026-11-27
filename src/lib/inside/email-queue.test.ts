import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const ROOT = new URL("../../../", import.meta.url);
const BASE_MIGRATION = "supabase/migrations/20261016000001_waitlist_email_queue.sql";
const MIGRATION = "supabase/migrations/20261017000001_email_queue_audience_consistency.sql";
const API = "src/app/api/inside/email-queue/route.ts";
const CLIENT = "src/app/inside/inside-client.tsx";

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

function functionBody(migration: string, functionName: string): string {
  const start = migration.indexOf(`function public.${functionName}(`);
  assert.notEqual(start, -1, `${functionName} must exist`);
  const end = migration.indexOf("$$;", start);
  assert.notEqual(end, -1, `${functionName} must have a complete SQL body`);
  return migration.slice(start, end);
}

describe("waitlist email queue audience and snapshot", () => {
  it("preserves one eligible row per active photo-complete student", () => {
    const migration = code(src(MIGRATION));
    const audience = functionBody(migration, "waitlist_email_eligible_students");
    assert.ok(audience.includes("returns table"));
    assert.ok(audience.includes("public.profiles p"));
    assert.ok(audience.includes("join public.verification_records v on v.user_id = p.user_id"));
    assert.ok(audience.includes("p.is_active is distinct from false"));
    assert.ok(audience.includes("exists ("));
    assert.ok(audience.includes("from public.profile_photos ph"));
    assert.ok(audience.includes("where ph.profile_id = p.id"));
    assert.ok(audience.includes("v.email is not null"));
    assert.ok(audience.includes("btrim(v.email) <> ''"));
    assert.ok(audience.includes("char_length(btrim(v.email)) <= 254"));
    assert.ok(audience.includes("lower(btrim(v.email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'"));
    assert.ok(audience.includes("not like 'u-%@us.signin.invalid'"));
    assert.ok(!audience.includes("distinct on"), "students must not be collapsed by email");
    assert.ok(!audience.includes("profile_photos ph on"), "photo existence must not multiply rows");
  });

  it("uses the same audience for the headline count and View Students payload", () => {
    const migration = code(src(MIGRATION));
    const summary = functionBody(migration, "admin_waitlist_email_queue_summary");
    assert.equal(
      (summary.match(/waitlist_email_eligible_students\(\)/g) ?? []).length,
      1,
      "the summary must resolve the source audience once",
    );
    assert.ok(summary.includes("count(*)::integer as waiting_student_count"));
    assert.ok(summary.includes("count(distinct email)::integer as unique_recipient_count"));
    assert.ok(summary.includes("'waitingStudentCount'"));
    assert.ok(summary.includes("'uniqueRecipientCount'"));
    assert.ok(summary.includes("'students'"));
    assert.ok(summary.includes("'skippedCount'"));
    for (const field of ["username", "nickname", "usn", "spot", "email"]) {
      assert.ok(summary.includes(`'${field}'`), `View Students includes ${field}`);
    }
    assert.ok(summary.includes("(select count(*)::integer from public.profiles)"));
    assert.ok(summary.includes("if not public.is_admin() then"));
  });

  it("deduplicates only normalized recipients while preserving shared-email students", () => {
    const migration = code(src(MIGRATION));
    const prepare = functionBody(migration, "admin_prepare_waitlist_email_queue");
    assert.equal(
      (prepare.match(/waitlist_email_eligible_students\(\)/g) ?? []).length,
      1,
      "preparation must resolve the same source audience once",
    );
    assert.ok(prepare.includes("select distinct on (a.email)"));
    assert.ok(prepare.includes("order by a.email, a.user_id"));
    assert.ok(prepare.includes("insert into public.waitlist_email_queue (user_id, email)"));
    assert.ok(prepare.includes("on conflict (email) do nothing"));
    assert.ok(prepare.includes("'waitingStudentCount'"));
    assert.ok(prepare.includes("'uniqueRecipientCount'"));
    assert.ok(prepare.includes("'addedCount'"));
    assert.ok(prepare.includes("'alreadyPreparedCount'"));
    assert.ok(prepare.includes("'skippedCount'"));
    assert.ok(prepare.includes("v_already_prepared_count := v_unique_recipient_count - v_added_count"));
    assert.ok(prepare.includes("jsonb_array_elements_text(v_recipients)"));
    assert.ok(prepare.includes("from public.waitlist_email_queue q"));
    assert.ok(prepare.includes("'recipients', v_recipients"));
  });

  it("retains the queue uniqueness, normalized snapshot, RLS, and idempotent conflict handling", () => {
    const base = code(src(BASE_MIGRATION));
    const migration = code(src(MIGRATION));
    for (const column of [
      "user_id uuid",
      "email text not null unique",
      "status text not null default 'PENDING'",
      "attempts integer not null default 0",
      "next_attempt_at timestamptz not null default now()",
      "provider_message_id text null",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
      "sent_at timestamptz null",
      "last_error text null",
    ]) {
      assert.ok(base.includes(column), `queue schema retains ${column}`);
    }
    assert.ok(base.includes("email text not null unique"));
    assert.ok(base.includes("email = lower(btrim(email))"));
    assert.ok(base.includes("email not like 'u-%@us.signin.invalid'"));
    assert.ok(base.includes("on delete set null"));
    assert.ok(base.includes("enable row level security"));
    assert.ok(!/create policy[^;]*waitlist_email_queue/i.test(base));
    for (const role of ["public", "anon", "authenticated"]) {
      assert.ok(base.includes(`revoke all on table public.waitlist_email_queue from ${role}`));
    }
    assert.ok(migration.includes("drop function if exists public.waitlist_email_eligible_recipients()"));
    assert.ok(migration.includes("on conflict (email) do nothing"));
  });
});

describe("waitlist email queue admin API", () => {
  it("returns bounded queue counts without exposing the database audience", () => {
    assert.ok(existsSync(new URL(API, ROOT)));
    const api = code(src(API)).replace(/\s+/g, " ");
    assert.equal((api.match(/requireInsideAdmin\(\)/g) ?? []).length, 2);
    assert.ok(api.includes("verifySameOrigin(req)"));
    assert.ok(api.includes('rpc( "admin_waitlist_email_queue_summary"'));
    assert.ok(api.includes('rpc( "admin_prepare_waitlist_email_queue"'));
    assert.ok(api.includes("result.addedCount + result.alreadyPreparedCount !== result.uniqueRecipientCount"));
    assert.ok(api.includes("waitingStudentCount: summary.waitingStudentCount"));
    assert.ok(api.includes("lastPreparedAt: summary.lastPreparedAt"));
    assert.ok(!api.includes("NextResponse.json(summary)"), "never serialize the raw RPC object");
    assert.ok(!api.includes("summary.students"));
    assert.ok(!api.includes("summary.recipients"));
    assert.ok(!api.includes("result.recipients"));
    assert.ok(api.includes("status: 403"));
    assert.ok(!/verification_records|email_verification_queue|BREVO|sendFeedbackReplyEmail/i.test(api));
    assert.ok(!api.includes("admin_list_students"));
  });

  it("does not expose internal IDs or omit queue preparation security checks", () => {
    const api = code(src(API));
    assert.ok(api.includes("requireInsideAdmin()"));
    assert.ok(api.includes("verifySameOrigin(req)"));
    assert.ok(api.includes("uniqueRecipientCount"));
    assert.ok(!api.includes("user_id"));
  });
});

describe("waitlist email queue UI", () => {
  it("uses aggregate queue data only; no student directory or private fields", () => {
    const client = code(src(CLIENT));
    const section = client.slice(
      client.indexOf("function EmailQueuePanel()"),
      client.indexOf("/* ---------------- system health"),
    );
    assert.ok(section.includes('fetch("/api/inside/email-queue"'));
    assert.ok(section.includes("summary.waitingStudentCount"));
    assert.ok(section.includes("summary?.uniqueRecipientCount"));
    assert.ok(!section.includes("summary?.students"));
    assert.ok(!section.includes("view students"));
    assert.ok(!section.includes("fetchStudentsPage"));
    assert.ok(!section.includes("/api/inside/students"));
    assert.ok(!section.includes("slice(0, 50)"));
    for (const field of ["student.username", "student.usn", "student.email", "student.nickname"]) {
      assert.ok(!section.includes(field), `aggregate UI must not read ${field}`);
    }
  });

  it("renders bounded preparation counts without a recipient snapshot", () => {
    const client = code(src(CLIENT));
    const section = client.slice(
      client.indexOf("function EmailQueuePanel()"),
      client.indexOf("/* ---------------- system health"),
    );
    for (const field of [
      "waitingStudentCount",
      "uniqueRecipientCount",
      "addedCount",
      "alreadyPreparedCount",
      "skippedCount",
    ]) {
      assert.ok(section.includes(`preparation.${field}`), `UI consumes server ${field}`);
    }
    assert.ok(!section.includes("preparation.recipients.map((email)"));
    assert.ok(!section.includes("student.email?.trim()"));
    assert.ok(!section.includes("new Set("), "the browser must not deduplicate recipients");
    assert.ok(section.includes("No emails were sent."));
    assert.ok(section.includes("prepared email"));
    assert.ok(section.includes("preview"));
    assert.ok(section.includes("waitlist-subject"));
    assert.ok(section.includes("waitlist-body"));
    assert.ok(!/sendWaitlistEmail|sendVerificationEmail|sendFeedbackReplyEmail|api\.brevo\.com/i.test(section));
    assert.ok(!/>\s*send\s*</i.test(section));
  });

  it("keeps StudentsPanel semantics separate", () => {
    const client = code(src(CLIENT));
    const start = client.indexOf("function StudentsPanel()");
    const end = client.indexOf("/* ----------------", start + 1);
    const studentsPanel = client.slice(start, end);
    assert.ok(studentsPanel.includes("fetchStudentsPage"));
    assert.ok(studentsPanel.includes("/api/inside/students"));
    assert.ok(studentsPanel.includes("studentState(s)"));
  });
});

describe("waitlist email queue audit and no-send boundary", () => {
  it("audits aggregate counts only and checks database admin membership", () => {
    const migration = code(src(MIGRATION));
    const prepare = functionBody(migration, "admin_prepare_waitlist_email_queue");
    assert.ok(prepare.includes("if not public.is_admin() then"));
    const audit = prepare.slice(prepare.indexOf("insert into public.inside_audit_events"));
    for (const field of [
      "waiting_student_count",
      "unique_recipient_count",
      "added_count",
      "already_prepared_count",
      "skipped_count",
    ]) {
      assert.ok(audit.includes(`'${field}'`), `audit has aggregate ${field}`);
    }
    assert.ok(!audit.includes("'email'"));
    assert.ok(!audit.includes("'subject'"));
    assert.ok(!audit.includes("'body'"));
    assert.ok(migration.includes("grant execute on function public.admin_waitlist_email_queue_summary() to authenticated"));
    assert.ok(migration.includes("grant execute on function public.admin_prepare_waitlist_email_queue() to authenticated"));
    assert.ok(migration.includes("revoke all on function public.admin_prepare_waitlist_email_queue() from anon"));
  });

  it("does not add a sender, provider call, or SENT transition", () => {
    const migration = code(src(MIGRATION));
    const api = code(src(API));
    const client = code(src(CLIENT));
    assert.ok(!/brevo|smtp|sendWaitlistEmail|api\.brevo\.com/i.test(migration));
    assert.ok(!/brevo|smtp|sendWaitlistEmail|api\.brevo\.com/i.test(api));
    assert.ok(!/sendWaitlistEmail|api\.brevo\.com/i.test(client));
    assert.ok(!/set\s+status\s*=\s*'SENT'|status:\s*["']SENT["']/i.test(migration));
  });

  it("leaves verification and feedback email senders untouched", () => {
    assert.ok(src("src/lib/feedback/reply-email.ts").includes("sendFeedbackReplyEmail"));
    assert.ok(src("src/lib/email-verification/brevo.ts").includes("sendVerificationEmail"));
  });
});
