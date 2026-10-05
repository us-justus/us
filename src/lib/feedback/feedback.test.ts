import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

/**
 * Static regression guards for the feedback Step 3 vertical slice
 * (student submission → /inside inbox → Brevo email reply → resolve).
 *
 * Live row-level behaviors (RLS as student/anon, 403s as non-admin,
 * Brevo delivery, audit attribution) run against staging; these tests
 * guard the properties that MUST hold in source: the migration reuses
 * verification_records.email + the Brevo env conventions instead of new
 * identity/config systems, the state machine stays OPEN/RESOLVED, every
 * privileged path reuses requireInsideAdmin() + is_admin() with no
 * client-supplied recipient/actor, the send-then-persist order holds, and
 * no launch/campaign machinery is introduced.
 */

const ROOT = new URL("../../../", import.meta.url);
const MIG = "supabase/migrations/20261014000001_feedback_admin_replies.sql";

function src(rel: string): string {
  return readFileSync(new URL(rel, ROOT), "utf8");
}

/** Drop comment lines so prose docs can't trip code assertions. */
function code(body: string): string {
  return body
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return (
        !t.startsWith("//") &&
        !t.startsWith("*") &&
        !t.startsWith("/*") &&
        !t.startsWith("--")
      );
    })
    .join("\n");
}

const SUBMIT_ROUTE = "src/app/api/feedback/route.ts";
const LIST_ROUTE = "src/app/api/inside/feedback/route.ts";
const REPLY_ROUTE = "src/app/api/inside/feedback/reply/route.ts";
const RESOLVE_ROUTE = "src/app/api/inside/feedback/resolve/route.ts";

describe("feedback — migration exists and models a minimal workflow", () => {
  it("migration file exists", () => {
    assert.ok(existsSync(new URL(MIG, ROOT)), "migration file must exist");
  });

  it("creates the feedback table with the required columns", () => {
    const body = code(src(MIG));
    for (const col of [
      "user_id",
      "category",
      "message",
      "status",
      "created_at",
      "resolved_at",
      "resolved_by",
      "admin_reply",
      "replied_at",
      "replied_by",
    ]) {
      assert.ok(body.includes(col), `schema must include ${col}`);
    }
    assert.ok(body.includes("references auth.users"), "user must reference auth.users");
    assert.ok(body.includes("default gen_random_uuid()"), "id must follow the project uuid convention");
  });

  it("keeps the state machine to OPEN/RESOLVED only", () => {
    const body = code(src(MIG));
    assert.ok(body.includes("'OPEN'") && body.includes("'RESOLVED'"), "OPEN/RESOLVED required");
    for (const s of ["PENDING", "IN_PROGRESS", "WAITING_FOR_USER", "ARCHIVED"]) {
      assert.ok(!body.includes(`'${s}'`), `must not introduce ${s}`);
    }
  });

  it("uses the controlled category vocabulary", () => {
    const body = code(src(MIG));
    for (const c of ["'BUG'", "'FEATURE'", "'ACCOUNT'", "'SAFETY'", "'OTHER'"]) {
      assert.ok(body.includes(c), `CHECK must allow ${c}`);
    }
  });

  it("bounds message and reply lengths at the DB level", () => {
    const body = code(src(MIG));
    assert.ok(body.includes("char_length(message) between 1 and 2000"), "message must be length-limited");
    assert.ok(body.includes("char_length(admin_reply)"), "reply must be length-limited");
  });

  it("enables RLS with own-insert/own-select only (no client update/delete)", () => {
    const body = code(src(MIG));
    assert.ok(body.includes("enable row level security"), "RLS must be enabled");
    assert.ok(body.includes("own feedback insert"), "own-insert policy required");
    assert.ok(body.includes("own feedback select"), "own-select policy required");
    assert.ok(!/create policy[^;]*for update/i.test(body), "no client UPDATE policy may exist");
    assert.ok(!/create policy[^;]*for delete/i.test(body), "no client DELETE policy may exist");
  });

  it("grants SELECT+INSERT to authenticated only (students submit + read history)", () => {
    const body = code(src(MIG));
    const grants = body.split("\n").filter((l) => /grant select, insert on table public\.feedback/i.test(l));
    assert.ok(grants.length >= 1, "authenticated needs SELECT+INSERT");
    assert.ok(!/grant[^;]*on table public\.feedback[^;]*to\s+anon/i.test(body), "no anon grant");
  });

  it("never reads auth.users (no passwords/tokens/auth internals reachable)", () => {
    const body = code(src(MIG));
    assert.ok(!/auth\.users/i.test(body.replace(/references auth\.users/g, "")), "auth.users must never be read");
  });

  it("extends the audit CHECK with exactly the two feedback actions", () => {
    const body = code(src(MIG));
    const i = body.indexOf("add constraint inside_audit_events_action_check");
    assert.ok(i >= 0, "CHECK constraint must be rewritten");
    const block = body.slice(i, i + 700);
    for (const a of ["FEEDBACK_REPLIED", "FEEDBACK_RESOLVED"]) {
      assert.ok(block.includes(`'${a}'`), `active CHECK must allow ${a}`);
    }
    for (const a of ["LAUNCH_ENABLED", "LAUNCH_DISABLED", "LAUNCH_VERSION_CHANGED"]) {
      assert.ok(!block.includes(`'${a}'`), `must not reintroduce ${a}`);
    }
    for (const a of [
      "ADMIN_LOGIN_SUCCESS",
      "ADMIN_LOGIN_FAILURE",
      "ADMIN_LOGOUT",
      "STUDENT_SUSPENDED",
      "STUDENT_RESTORED",
      "REPORT_RESOLVED",
    ]) {
      assert.ok(block.includes(`'${a}'`), `active CHECK must keep ${a}`);
    }
  });

  it("creates the two admin RPCs, both guarded by is_admin()", () => {
    const body = code(src(MIG));
    assert.ok(body.includes("function public.admin_list_feedback("), "listing RPC must exist");
    assert.ok(body.includes("function public.admin_resolve_feedback("), "resolver RPC must exist");
    const guards = body.match(/if not public\.is_admin\(\) then/g) ?? [];
    assert.ok(guards.length >= 2, `every RPC must re-check is_admin(), found ${guards.length}`);
  });

  it("grants RPC EXECUTE to authenticated only", () => {
    const body = code(src(MIG));
    assert.ok(!/grant execute[^;]*to\s+anon/i.test(body), "no anon EXECUTE grants");
    const grants = body.split("\n").filter((l) => /grant execute/i.test(l));
    assert.ok(grants.length >= 2, "each RPC needs an explicit grant");
    for (const g of grants) {
      assert.ok(/to authenticated/.test(g), `grant must target authenticated only: ${g}`);
    }
  });

  it("listing resolves total + page in one statement (staging 42P01 regression)", () => {
    const body = code(src(MIG));
    const i = body.indexOf("function public.admin_list_feedback(");
    assert.ok(i >= 0);
    const block = body.slice(i, i + 4000);
    assert.ok(!/select count\(\*\) into/i.test(block), "no two-step COUNT");
    assert.ok(block.includes("into v_result"), "single INTO of the combined object");
  });

  it("listing defaults to open and joins trusted student context", () => {
    const body = code(src(MIG));
    const i = body.indexOf("function public.admin_list_feedback(");
    const block = body.slice(i, i + 6000);
    assert.ok(block.includes("public.verification_records"), "email source stays verification_records");
    assert.ok(block.includes("public.feedback"), "reads the feedback table");
    assert.ok(block.includes("invalid feedback status filter"), "must reject bad status values");
  });

  it("resolver is OPEN -> RESOLVED only with a no-op changed flag", () => {
    const body = code(src(MIG));
    const i = body.indexOf("function public.admin_resolve_feedback(");
    assert.ok(i >= 0);
    const block = body.slice(i, i + 2000);
    assert.ok(block.includes("'changed', false") && block.includes("'changed', true"), "changed flag required");
    assert.ok(block.includes("resolved_by = auth.uid()"), "actor must come from the caller JWT, never a parameter");
  });
});

describe("feedback — student submission (validation, identity, throttle)", () => {
  it("route files exist", () => {
    assert.ok(existsSync(new URL(SUBMIT_ROUTE, ROOT)), "student route must exist");
    assert.ok(existsSync(new URL("src/app/feedback/page.tsx", ROOT)), "student page must exist");
    assert.ok(existsSync(new URL("src/app/feedback/client.tsx", ROOT)), "student client must exist");
  });

  it("requires an authenticated user (401, never trusts client identity)", () => {
    const body = code(src(SUBMIT_ROUTE));
    assert.ok(body.includes("supabase.auth.getUser()"), "must load the session user");
    assert.ok(body.includes("status: 401"), "must refuse anonymous callers");
    assert.ok(body.includes("user_id: user.id"), "identity comes from the session");
    assert.ok(!body.includes("body?.user_id") && !body.includes("body.user_id"), "must not read user_id from the client");
    assert.ok(!/body\??\.\s*email/.test(body), "must never ask for or read an email from the client");
  });

  it("validates the category allowlist and message limits", () => {
    const body = code(src(SUBMIT_ROUTE));
    assert.ok(body.includes("isFeedbackCategory"), "must allowlist the category");
    assert.ok(body.includes("validateFeedbackMessage"), "must validate the message");
    assert.ok(body.includes("status: 400"), "must reject bad input");
    const lib = code(src("src/lib/feedback/constants.ts"));
    for (const c of ['"BUG"', '"FEATURE"', '"ACCOUNT"', '"SAFETY"', '"OTHER"']) {
      assert.ok(lib.includes(c), `constants must define ${c}`);
    }
    assert.ok(lib.includes("2000"), "message limit must be defined");
  });

  it("throttles per-user submissions (429, no new infrastructure)", () => {
    const body = code(src(SUBMIT_ROUTE));
    assert.ok(body.includes("status: 429"), "must throttle");
    assert.ok(body.includes("FEEDBACK_SUBMIT_PER_HOUR"), "must use the shared throttle constant");
  });

  it("returns a minimal success shape (no DB internals)", () => {
    const body = code(src(SUBMIT_ROUTE));
    assert.ok(body.includes("Could not send feedback. Try again."), "must hide DB errors");
    assert.ok(!/error\.message/.test(body), "must not leak database errors");
  });

  it("own history exposes no admin-only fields", () => {
    const body = code(src(SUBMIT_ROUTE));
    const getAt = body.indexOf("export async function GET()");
    assert.ok(getAt >= 0);
    const block = body.slice(getAt, getAt + 1200);
    assert.ok(block.includes("id, category, message, status, created_at"), "projection must be student-safe");
    for (const f of ["admin_reply", "replied_by", "resolved_by", "brevo_message_id"]) {
      assert.ok(!block.includes(f), `history must not expose ${f}`);
    }
  });

  it("student page is server-guarded and never mints sessions on protected pages", () => {
    const body = code(src("src/app/feedback/page.tsx"));
    assert.ok(body.includes("getProductSession"), "must use the product session");
    assert.ok(body.includes("guardProductSession"), "must guard the session");
    assert.ok(!body.includes("useAnonymousSession"), "must never mint anonymous sessions here");
    const client = code(src("src/app/feedback/client.tsx"));
    assert.ok(client.includes("useExistingSession"), "client must reuse the existing session");
  });
});

describe("feedback — admin authorization (non-admin/anon cannot)", () => {
  for (const rel of [LIST_ROUTE, REPLY_ROUTE, RESOLVE_ROUTE]) {
    it(`${rel} reuses requireInsideAdmin() and refuses with 403`, () => {
      const body = code(src(rel));
      assert.ok(body.includes("requireInsideAdmin()"), `${rel} must check the gate`);
      assert.ok(body.includes("status: 403"), `${rel} must refuse with 403`);
    });
  }

  it("state-changing routes enforce the Origin check", () => {
    for (const rel of [REPLY_ROUTE, RESOLVE_ROUTE]) {
      assert.ok(code(src(rel)).includes("verifySameOrigin"), `${rel} must check Origin`);
    }
  });

  it("mutations go through is_admin()-checked RPCs / service-role only", () => {
    assert.ok(code(src(LIST_ROUTE)).includes("admin_list_feedback"), "list must use the RPC");
    assert.ok(code(src(RESOLVE_ROUTE)).includes("admin_resolve_feedback"), "resolve must use the RPC");
    const replyBody = code(src(REPLY_ROUTE));
    assert.ok(replyBody.includes("createServiceRoleClient"), "reply resolves email via the privileged client");
    assert.ok(!code(src(RESOLVE_ROUTE)).includes(".insert("), "resolve must not insert");
    for (const rel of [REPLY_ROUTE, RESOLVE_ROUTE]) {
      assert.ok(!code(src(rel)).includes(".delete("), `${rel} must not delete`);
    }
  });

  it("no route accepts recipient, student, or admin from the browser", () => {
    for (const rel of [REPLY_ROUTE, RESOLVE_ROUTE]) {
      const body = code(src(rel));
      assert.ok(!body.includes("recipient_email"), `no recipient field in ${rel}`);
      assert.ok(!body.includes("student_id"), `no student field in ${rel}`);
      assert.ok(!body.includes("admin_id"), `no admin field in ${rel}`);
      assert.ok(!body.includes("actor_user_id"), `no actor field in ${rel}`);
    }
    const replyBody = code(src(REPLY_ROUTE));
    assert.ok(replyBody.includes("verification_records"), "recipient resolves from the trusted email record");
    assert.ok(!/\.from\("verification_records"\)[^;]*\.insert/i.test(replyBody), "never writes the email record");
  });
});

describe("feedback — reply flow (recipient, order, failure behavior)", () => {
  it("reply sender is server-only and reuses the Brevo configuration", () => {
    const body = code(src("src/lib/feedback/reply-email.ts"));
    assert.ok(body.includes('typeof window !== "undefined"'), "must refuse client import");
    assert.ok(body.includes("process.env.BREVO_API_KEY"), "must reuse the Brevo API key");
    assert.ok(body.includes("process.env.BREVO_SENDER_EMAIL"), "must reuse the sender email");
    assert.ok(body.includes("api.brevo.com/v3/smtp/email"), "must use the same SMTP endpoint");
    assert.ok(!body.includes("email_verification_queue"), "must not couple to the verification queue");
  });

  it("email identifies us and exposes no internals", () => {
    const body = code(src("src/lib/feedback/reply-email.ts"));
    assert.ok(body.includes("Re: Your feedback about us"), "subject must identify the reply");
    assert.ok(body.includes("just us."), "signature must carry the product voice");
    for (const s of ["supabase", "actor_user_id", "feedback_id", "process.env.SUPABASE"]) {
      assert.ok(!body.includes(s), `email module must not reference ${s}`);
    }
  });

  it("recipient rejects empty, internal, and malformed addresses (no send)", () => {
    const body = code(src(REPLY_ROUTE));
    assert.ok(body.includes("isInternalEmail"), "must reject the internal sign-in identity");
    assert.ok(body.includes("status: 422"), "invalid recipient must fail without sending");
    const gate422 = body.indexOf("status: 422");
    const sendAt = body.indexOf("sendFeedbackReplyEmail({");
    assert.ok(gate422 >= 0 && sendAt > gate422, "recipient gate must run before any send");
    assert.ok(!body.includes("u-") || body.indexOf("isInternalEmail") < sendAt, "internal check must precede the send");
  });

  it("send happens before persist (row unchanged when Brevo fails)", () => {
    const body = code(src(REPLY_ROUTE));
    const sendAt = body.indexOf("await sendFeedbackReplyEmail(");
    assert.ok(sendAt >= 0, "must send through Brevo");
    // The persist is the UPDATE after the send (the earlier .from("feedback")
    // is the pre-send load) — anchor on the update, not the first select.
    const persistAt = body.indexOf(".update({", sendAt);
    assert.ok(persistAt > sendAt, "persist must run only after the send");
    const failBlock = body.slice(sendAt, persistAt + 200);
    assert.ok(failBlock.includes("status: 502"), "Brevo failure must surface a 502 with nothing persisted");
    assert.ok(body.includes("emailSent: true"), "post-send persist failure must flag the delivered email");
  });

  it("persists reply metadata including the provider message id", () => {
    const body = code(src(REPLY_ROUTE));
    for (const f of ["admin_reply", "replied_at", "replied_by", "brevo_message_id"]) {
      assert.ok(body.includes(f), `persist must record ${f}`);
    }
    assert.ok(body.includes("replied_by: gate.userId"), "replier comes from the admin gate");
  });

  it("reply audit is best-effort (a delivered email is never failed for audit)", () => {
    const body = code(src(REPLY_ROUTE));
    // Anchor on the audit ACTION (the import line also names the helper).
    const auditAt = body.indexOf('"FEEDBACK_REPLIED"');
    const okAt = body.indexOf("replied: true");
    assert.ok(auditAt >= 0 && okAt > auditAt, "audit must precede the success response");
    // No fail-closed compensation for replies: the email cannot be
    // unsent, so the route still succeeds (verified by the absence of a
    // 500 between the audit call and the success response).
    const tail = body.slice(auditAt, okAt);
    assert.ok(!tail.includes("status: 500"), "audit failure must not fail a delivered reply");
  });

  it("reply validates its inputs and never resolves", () => {
    const body = code(src(REPLY_ROUTE));
    assert.ok(body.includes("validateFeedbackReply"), "must validate the reply body");
    assert.ok(body.includes("status: 400"), "must reject bad input");
    assert.ok(!body.includes("RESOLVED"), "reply must never change status");
  });

  it("resolve audits with previous/new status and fails closed", () => {
    const body = code(src(RESOLVE_ROUTE));
    assert.ok(body.includes('"FEEDBACK_RESOLVED"'), "must audit the resolution");
    assert.ok(body.includes('targetType: "feedback"'), "target must be the feedback");
    assert.ok(body.includes("previous_status") && body.includes("new_status"), "must record the transition");
    assert.ok(body.includes("changed !== true"), "no-ops must record no event");
    assert.ok(body.includes("restoring previous state"), "audit failure must compensate");
    const i = body.indexOf("restoring previous state");
    assert.ok(body.slice(i, i + 600).includes("status: 500"), "must 500, never silent success");
  });

  it("resolve sends no email", () => {
    const body = code(src(RESOLVE_ROUTE));
    assert.ok(!body.includes("sendFeedbackReplyEmail"), "resolve must not email");
    assert.ok(!body.includes("brevo"), "resolve must not touch Brevo");
  });
});

describe("feedback — audit, inbox UI, and scope", () => {
  it("audit action set includes the two feedback actions", () => {
    const body = code(src("src/lib/inside/audit.ts"));
    for (const a of ["FEEDBACK_REPLIED", "FEEDBACK_RESOLVED"]) {
      assert.ok(body.includes(`"${a}"`), `action set must include ${a}`);
    }
  });

  it("dashboard hierarchy is Overview / Students / Feedback / Reports / Health", () => {
    const body = code(src("src/app/inside/inside-client.tsx"));
    const s = body.indexOf("<StudentsPanel />");
    const f = body.indexOf("<FeedbackPanel />");
    const r = body.indexOf("<ReportsPanel />");
    const h = body.indexOf("<HealthPanel />");
    assert.ok(s >= 0 && f >= 0 && r >= 0 && h >= 0, "all four panels must render");
    assert.ok(s < f && f < r && r < h, "order must be students, feedback, reports, health");
  });

  it("inbox defaults to open with an open/resolved/all filter", () => {
    const body = code(src("src/app/inside/inside-client.tsx"));
    // The option list lives at module level; the default open fetch +
    // selected-state filter live inside the panel — assert both scopes.
    assert.ok(
      body.includes('"open"') && body.includes('"resolved"') && body.includes('"all"'),
      "filter options required",
    );
    const i = body.indexOf("function FeedbackPanel()");
    assert.ok(i >= 0);
    const block = body.slice(i, i + 12000);
    assert.ok(/status=open/.test(block), "default fetch must prioritize open");
    assert.ok(block.includes("aria-pressed"), "filter must expose its selected state");
  });

  it("inbox rows expose identity context; detail shows USN + email + message + actions", () => {
    const body = code(src("src/app/inside/inside-client.tsx"));
    const i = body.indexOf("function FeedbackPanel()");
    const block = body.slice(i, i + 14000);
    assert.ok(block.includes("f.email"), "row must show email");
    assert.ok(block.includes("f.usn"), "detail must show USN");
    assert.ok(block.includes("f.message"), "detail must show the message");
    assert.ok(block.includes("reply by email"), "reply action required");
    assert.ok(block.includes("resolve"), "resolve action required");
    // Queue, not chat: no free-form thread UI.
    assert.ok(!block.includes("thread"), "must not build thread UI");
  });

  it("no launch functionality is introduced", () => {
    const banned = [
      "launch_config",
      "admin_set_launch",
      "getLaunchState",
      "guardLaunch",
      "productPhaseFor",
      "isLaunchGatedPath",
      "prelaunch_version",
    ];
    for (const rel of [
      MIG,
      SUBMIT_ROUTE,
      LIST_ROUTE,
      REPLY_ROUTE,
      RESOLVE_ROUTE,
      "src/lib/feedback/constants.ts",
      "src/lib/feedback/reply-email.ts",
      "src/app/feedback/page.tsx",
      "src/app/feedback/client.tsx",
    ]) {
      const body = src(rel);
      for (const b of banned) {
        assert.ok(!body.includes(b), `no launch reference ${b} in ${rel}`);
      }
    }
    const mig = code(src(MIG));
    assert.ok(!/LAUNCH_ENABLED|LAUNCH_DISABLED|LAUNCH_VERSION_CHANGED/.test(mig), "migration must not name launch actions");
  });

  it("no campaign/queue/notification machinery is introduced", () => {
    const banned = ["campaign", "broadcast", "unsubscribe", "template", "schedule", "bulk", "notification"];
    for (const rel of [
      MIG,
      SUBMIT_ROUTE,
      LIST_ROUTE,
      REPLY_ROUTE,
      RESOLVE_ROUTE,
      "src/lib/feedback/constants.ts",
      "src/lib/feedback/reply-email.ts",
    ]) {
      const body = code(src(rel)).toLowerCase();
      for (const b of banned) {
        assert.ok(!body.includes(b), `no ${b} machinery in ${rel}`);
      }
    }
    const mig = code(src(MIG));
    assert.ok(!/create\s+table/i.test(mig.replace(/create table if not exists public\.feedback \(/i, "")), "no tables beyond feedback");
  });

  it("historical staging migrations are untouched", () => {
    for (const m of [
      "supabase/migrations/20261012000001_remove_launch_system.sql",
      "supabase/migrations/20261013000001_inside_dashboard_refinement.sql",
    ]) {
      const body = src(m);
      assert.ok(!body.includes("feedback"), `${m} must stay untouched`);
    }
  });
});
