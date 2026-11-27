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

/** Restrict UI assertions to FeedbackPanel, not later panels in the file. */
function feedbackPanel(body: string): string {
  const start = body.indexOf("function FeedbackPanel()");
  if (start < 0) return "";
  const tail = body.slice(start);
  const end = tail.indexOf("\nfunction ReportsPanel()");
  return end >= 0 ? tail.slice(0, end) : tail;
}

const SUBMIT_ROUTE = "src/app/api/feedback/route.ts";
const LIST_ROUTE = "src/app/api/inside/feedback/route.ts";
const REPLY_ROUTE = "src/app/api/inside/feedback/reply/route.ts";
const RESOLVE_ROUTE = "src/app/api/inside/feedback/resolve/route.ts";
const GRANTS_MIG = "supabase/migrations/20261027000001_feedback_service_role_grants.sql";
const CLAIMS_MIG = "supabase/migrations/20261123000002_issue14_feedback_reply_claims.sql";
const RECOVER_ROUTE = "src/app/api/inside/feedback/reply/recover/route.ts";

/** Comma-separated SQL column list → sorted names. */
function columnsOf(body: string, statement: RegExp): string[] {
  const list = body.match(statement)?.[1] ?? "";
  return list
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .sort();
}

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

describe("feedback — service-role grants (production 42501 regression)", () => {
  it("grants SELECT only on the columns the routes read (INSERT ... RETURNING)", () => {
    assert.ok(existsSync(new URL(GRANTS_MIG, ROOT)), "grants migration must exist");
    assert.deepEqual(
      columnsOf(
        code(src(GRANTS_MIG)),
        /grant select \(([^)]*)\) on table public\.feedback to service_role/i,
      ),
      // id: INSERT ... RETURNING id + WHERE id; the rest: reply lookup.
      ["category", "id", "status", "user_id"],
    );
  });

  it("grants UPDATE only on the columns the reply route persists", () => {
    assert.deepEqual(
      columnsOf(
        code(src(GRANTS_MIG)),
        /grant update \(([^)]*)\) on table public\.feedback to service_role/i,
      ),
      ["admin_reply", "brevo_message_id", "replied_at", "replied_by"],
    );
  });

  it("keeps existing INSERT and widens no client role, RLS, or schema", () => {
    const body = code(src(GRANTS_MIG));
    // No table-level DML grant (column-scoped only) and nothing for clients.
    assert.ok(
      !/grant\s+(select|update|insert|all)\s+on\s+table\s+public\.feedback\b/i.test(body),
      "no table-level grant may be added",
    );
    assert.ok(!/grant[^;]*to\s+(anon|authenticated|public)\b/i.test(body), "no client-role grant");
    assert.ok(
      !/(create|alter|drop)\s+(table|policy|view|trigger|function|index)/i.test(body),
      "no schema or RLS change",
    );
    assert.ok(!/\b(row level security|insert into|delete from)\b/i.test(body), "no RLS or data change");
    // The submit route still inserts; only reads/updates were missing.
    assert.ok(!/revoke[^;]*insert[^;]*from service_role/i.test(body), "INSERT must stay granted");
  });

  it("covers every column the submit and reply routes actually touch", () => {
    const submit = code(src(SUBMIT_ROUTE));
    const reply = code(src(REPLY_ROUTE));
    const grants = code(src(GRANTS_MIG));
    const selectCols = columnsOf(
      grants,
      /grant select \(([^)]*)\) on table public\.feedback to service_role/i,
    );
    const updateCols = columnsOf(
      grants,
      /grant update \(([^)]*)\) on table public\.feedback to service_role/i,
    );

    // Submit: INSERT ... RETURNING "id".
    assert.match(submit, /\.insert\(\{[\s\S]*?\}\)\s*\.select\("id"\)\s*\.single\(\)/);
    assert.ok(selectCols.includes("id"), "RETURNING id needs column SELECT");

    // Reply lookup projection must be fully covered for both RETURNING and WHERE.
    const lookup = reply.match(/\.select\("([^"]+)"\)/)?.[1] ?? "";
    assert.ok(lookup.includes("user_id"), "reply lookup projection must be found");
    for (const col of lookup.split(",").map((c) => c.trim())) {
      assert.ok(selectCols.includes(col), `reply lookup reads ungranted column ${col}`);
    }
    // Reply finalization is a service-role-only RPC that writes the same
    // four columns atomically with the claim transition.
    const finalizeAt = reply.indexOf("admin_finalize_feedback_reply");
    assert.ok(finalizeAt >= 0, "reply must finalize through the atomic RPC");
    const claims = code(src(CLAIMS_MIG));
    for (const col of ["admin_reply", "replied_at", "replied_by", "brevo_message_id"]) {
      assert.ok(claims.includes(col), `reply finalize must record ${col}`);
      assert.ok(updateCols.includes(col), `reply persist writes ungranted column ${col}`);
    }
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

  it("logs only database error codes, never messages or user data", () => {
    const body = code(src(SUBMIT_ROUTE));
    assert.ok(
      body.includes('console.error("[feedback] submit failed", error?.code ?? "empty")'),
      "insert failure must log the error code only",
    );
    assert.ok(
      body.includes('console.error("[feedback] throttle check failed", countError.code)'),
      "throttle failure must log the error code only",
    );
    assert.ok(
      body.includes('console.error("[feedback] submit threw", errorCode(err))'),
      "unexpected failures must log a sanitized code only",
    );
    assert.ok(!/console\.(log|error|warn|info)\([^)]*\.message/.test(body), "never log messages");
    assert.ok(!/console\.(log|error|warn|info)\([^)]*user\.id/.test(body), "never log identifiers");
    assert.ok(
      !/console\.(log|error|warn|info)\([^)]*\b(message|content|feedbackText)\b/.test(body),
      "never log feedback content",
    );
  });

  it("answers unexpected exceptions with the same generic 500", () => {
    const body = code(src(SUBMIT_ROUTE));
    const catchBlock = body.slice(body.indexOf("} catch (err) {"));
    assert.ok(catchBlock.length > 0, "insert path must be guarded");
    assert.ok(
      catchBlock.includes("Could not send feedback. Try again.") &&
        catchBlock.includes("status: 500"),
      "unexpected failures must not leak a server error page",
    );
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
  for (const rel of [LIST_ROUTE, REPLY_ROUTE, RESOLVE_ROUTE, RECOVER_ROUTE]) {
    it(`${rel} reuses requireInsideAdmin() and refuses with 403`, () => {
      const body = code(src(rel));
      assert.ok(body.includes("requireInsideAdmin()"), `${rel} must check the gate`);
      assert.ok(body.includes("status: 403"), `${rel} must refuse with 403`);
    });
  }

  it("reply refuses non-admins before any privileged client is created", () => {
    const body = code(src(REPLY_ROUTE));
    const gateAt = body.indexOf("requireInsideAdmin()");
    const serviceAt = body.indexOf("createServiceRoleClient()");
    assert.ok(gateAt >= 0, "admin gate required");
    assert.ok(serviceAt > gateAt, "no service-role client before the admin gate");
    assert.ok(body.includes("status: 403"), "non-admins get 403");
  });

  it("state-changing routes and recovery state reads enforce the Origin check", () => {
    for (const rel of [REPLY_ROUTE, RESOLVE_ROUTE, RECOVER_ROUTE]) {
      assert.ok(code(src(rel)).includes("verifySameOrigin"), `${rel} must check Origin`);
    }
    const body = code(src(RECOVER_ROUTE));
    const getAt = body.indexOf("export async function GET(");
    const postAt = body.indexOf("export async function POST(");
    assert.ok(getAt >= 0 && postAt > getAt);
    const getBlock = body.slice(getAt, postAt);
    assert.ok(getBlock.indexOf("verifySameOrigin(req)") < getBlock.indexOf("requireInsideAdmin()"));
    assert.ok(getBlock.indexOf("requireInsideAdmin()") < getBlock.indexOf("insideMutationRateLimit(req, gate.userId)"));
    const postBlock = body.slice(postAt);
    assert.ok(postBlock.indexOf("verifySameOrigin(req)") < postBlock.indexOf("requireInsideAdmin()"));
    assert.ok(postBlock.indexOf("requireInsideAdmin()") < postBlock.indexOf("insideMutationRateLimit(req, gate.userId)"));
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

  it("claims before send and finalizes only after provider success", () => {
    const body = code(src(REPLY_ROUTE));
    const claimAt = body.indexOf("admin_claim_feedback_reply");
    const sendAt = body.indexOf("await sendFeedbackReplyEmail(");
    const finalizeAt = body.indexOf("admin_finalize_feedback_reply");
    assert.ok(claimAt >= 0, "must atomically claim before sending");
    assert.ok(sendAt > claimAt, "claim must precede the Brevo call");
    assert.ok(finalizeAt > sendAt, "finalize/persist must run only after the send");
    const failBlock = body.slice(sendAt, finalizeAt);
    assert.ok(failBlock.includes("providerFailurePlan"), "Brevo failures must use the safe settlement plan");
    assert.ok(failBlock.includes("status: plan.status"), "Brevo failures must return the planned status");
    assert.ok(failBlock.includes("admin_settle_feedback_reply_claim"), "failed provider calls must settle the claim");
    assert.ok(body.includes("emailSent: true"), "post-send finalize failure must flag the delivered email");
    assert.ok(body.includes("persistPending: true"), "post-send finalize failure must expose recovery state");
  });

  it("stores the replier + reply body on the claim, never in the request", () => {
    const body = code(src(REPLY_ROUTE));
    assert.ok(body.includes("p_actor_id: gate.userId"), "replier comes from the admin gate");
    assert.ok(body.includes("p_reply_body: cleanReply"), "claim stores the intended reply body");
    assert.ok(!body.includes("recipient_email"), "no client recipient field");
    const claims = code(src(CLAIMS_MIG));
    for (const f of ["reply_body", "replied_by", "claim_token", "provider_message_id"]) {
      assert.ok(claims.includes(f), `claim must store ${f}`);
    }
  });

  it("refuses resolved, already-replied, and concurrent duplicate sends", () => {
    const body = code(src(REPLY_ROUTE));
    assert.ok(body.includes('row.status !== "OPEN"'), "resolved feedback must be refused");
    assert.ok(body.includes("claimFailureResponse"), "claim failures map to explicit 409s");
    assert.ok(body.includes("replyState"), "client receives the claim state");
    const claims = code(src(CLAIMS_MIG));
    assert.ok(claims.includes("for update"), "claim must serialize per feedback row");
    assert.ok(claims.includes("'in_progress'"), "concurrent claims must be refused");
    assert.ok(claims.includes("'already_replied'"), "existing replies must be refused");
    assert.ok(claims.includes("'resolved'"), "resolved feedback must be refused in SQL");
  });

  it("keeps ambiguous provider outcomes out of automatic retry", () => {
    const body = code(src(REPLY_ROUTE));
    assert.ok(body.includes("providerFailurePlan"), "provider failures must use the safe settlement plan");
    assert.ok(body.includes("UNCONFIRMED"), "ambiguous outcomes stay unconfirmed");
    const claims = code(src(CLAIMS_MIG));
    assert.ok(claims.includes("UNCONFIRMED"), "claim state must represent uncertainty");
    assert.ok(claims.includes("no automatic resend"), "unconfirmed claims are never auto-reclaimed");
  });

  it("provides explicit recovery without calling the provider", () => {
    const body = code(src(RECOVER_ROUTE));
    const postAt = body.indexOf("export async function POST(");
    const post = body.slice(postAt);
    assert.ok(post.includes("requireInsideAdmin()"), "recovery is admin-only");
    assert.ok(post.includes("verifySameOrigin"), "recovery is origin-protected");
    assert.ok(post.includes("insideMutationRateLimit"), "recovery is rate-limited");
    assert.ok(post.includes("admin_recover_feedback_reply"), "recovery uses the service-role RPC");
    assert.ok(post.includes('outcome !== "sent" && outcome !== "not_sent"'), "outcome must be explicit");
    assert.ok(post.includes('p_outcome: outcome'), "the admin choice is passed to the RPC");
    assert.ok(post.includes("p_actor_id: gate.userId"), "actor comes only from the admin gate");
    assert.ok(post.includes("result.changed === true"), "both outcomes are reported from the RPC");
    assert.ok(post.includes("status: 404"), "a missing attempt is reported clearly");
    assert.ok(!post.includes("p_reply_body"), "recovery cannot supply a reply body");
    assert.ok(!post.includes("p_claim_token"), "recovery cannot supply a claim token");
    assert.ok(!post.includes("sendFeedbackReplyEmail"), "recovery must never resend");
    assert.ok(!/api\.brevo\.com|providerFailurePlan|admin_claim_feedback_reply/i.test(post), "recovery must never send or auto-retry");
  });

  it("exposes only the allowlisted attempt state to the admin UI", () => {
    const body = code(src(RECOVER_ROUTE));
    const getAt = body.indexOf("export async function GET(");
    const postAt = body.indexOf("export async function POST(");
    const get = body.slice(getAt, postAt);
    assert.ok(get.includes('from("feedback_reply_attempts")'));
    assert.ok(get.includes('.select("state")'), "only the state column is read");
    assert.ok(get.includes("feedbackRecoveryView"), "the response is projected through the allowlist");
    assert.ok(get.includes("status: 400"), "invalid feedback ids are rejected");
    assert.ok(!/NextResponse\.json\(data\)/.test(get), "raw rows are never returned");
    for (const field of [
      "claim_token",
      "reply_body",
      "replied_by",
      "provider_message_id",
      "recipient_email",
      "usn",
      "username",
      "nickname",
    ]) {
      assert.ok(!get.includes(field), `state API must not expose ${field}`);
    }
  });

  it("covers persistPending recovery and role denials in SQL tests", () => {
    const sql = src("supabase/tests/issue14_feedback_reply_claims.sql");
    assert.ok(sql.includes("select plan(43)"));
    assert.ok(sql.includes("persistPending attempt remains SENDING"));
    assert.ok(sql.includes("sent recovery resolves a persistPending attempt"));
    assert.ok(sql.includes("anon cannot execute recovery RPC"));
    assert.ok(sql.includes("authenticated cannot execute recovery RPC"));
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
    const block = feedbackPanel(body);
    assert.ok(block.length > 0);
    assert.ok(/status=open/.test(block), "default fetch must prioritize open");
    assert.ok(block.includes("aria-pressed"), "filter must expose its selected state");
  });

  it("inbox rows expose identity context; detail shows USN + email + message + actions", () => {
    const body = feedbackPanel(code(src("src/app/inside/inside-client.tsx")));
    assert.ok(body.includes("f.email"), "row must show email");
    assert.ok(body.includes("f.usn"), "detail must show USN");
    assert.ok(body.includes("f.message"), "detail must show the message");
    assert.ok(body.includes("reply by email"), "reply action required");
    assert.ok(body.includes("resolve"), "resolve action required");
    // Queue, not chat: no free-form thread UI.
    assert.ok(!body.includes("thread"), "must not build thread UI");
  });

  it("offers explicit Brevo-verified recovery without automatic retry", () => {
    const block = feedbackPanel(code(src("src/app/inside/inside-client.tsx")));
    assert.ok(block.length > 0);
    assert.ok(
      block.includes("/api/inside/feedback/reply/recover?feedbackId=${encodeURIComponent(id)}"),
      "the panel reads persisted attempt state",
    );
    assert.ok(block.includes("feedbackRecoveryView"), "UI uses the allowlisted state projection");
    assert.ok(block.includes("Check the Brevo logs before choosing an outcome"));
    assert.ok(block.includes('outcome: "sent"'));
    assert.ok(block.includes('outcome: "not_sent"'));
    assert.ok(block.includes("Recovery sends no email and never retries automatically."));
    assert.ok(block.includes("No email is sent now."));
    assert.ok((block.match(/if \(acting !== null\) return;/g) ?? []).length >= 3, "duplicate clicks are refused");
    assert.ok(block.includes("disabled={loading || acting !== null}"));
    const recoverAt = block.indexOf("async function recoverReply(");
    const recover = block.slice(recoverAt, recoverAt + 2400);
    assert.ok(recover.includes("/api/inside/feedback/reply/recover"));
    assert.ok(!recover.includes('fetch("/api/inside/feedback/reply"'), "recovery never retries the send");
    assert.ok(!recover.includes("sendFeedbackReplyEmail"));
    assert.ok(!/api\.brevo\.com/i.test(block));
  });

  it("stale recovery reads cannot overwrite a newer attempt and block normal replies", () => {
    const block = feedbackPanel(code(src("src/app/inside/inside-client.tsx")));
    assert.ok(block.includes("const attemptRequestId = useRef(0);"));
    assert.ok(block.includes("attemptRequestId.current += 1;"));
    assert.ok(
      (block.match(/invalidateAttemptRequest\(\);/g) ?? []).length >= 3,
      "every state transition must invalidate older recovery reads",
    );
    assert.ok(block.includes("const requestId = ++attemptRequestId.current;"));
    assert.ok(block.includes("requestId !== attemptRequestId.current"), "stale success must be ignored");
    assert.ok(block.includes("requestId === attemptRequestId.current"), "stale failure must be ignored");
    assert.ok(block.includes("const recoveryPending = recovery?.recoverable === true;"));
    assert.ok(
      (block.match(/disabled=\{recoveryPending \|\| acting !== null\}/g) ?? []).length >= 2,
      "reply editor and send button must be disabled while recovery is pending",
    );
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
