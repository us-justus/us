import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  SUSPENSION_REASON_MAX,
  validateSuspensionReason,
} from "../auth/suspension.ts";

/**
 * Static regression guards for the Step 3 amendment: suspension reasons +
 * the suspended-login → appeal-feedback → admin review/reply loop.
 *
 * Live row-level behaviors (suspend/restore flips as admin, 403s as
 * student/anon, suspended login, appeal submission, Brevo delivery, audit
 * attribution) run against staging; these tests guard the properties that
 * MUST hold in source: the migration extends (never rewrites) the existing
 * schema, suspend requires a reason, restore clears current state while
 * audit history survives, login + the central product guard enforce
 * suspension server-side without blocking appeals, the appeal link is
 * server-derived (never client-claimed), the reason never reaches public
 * projections, and no out-of-scope machinery is introduced.
 */

const ROOT = new URL("../../../", import.meta.url);
const MIG = "supabase/migrations/20261015000001_suspension_reasons_appeals.sql";

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

const MODERATE_ROUTE = "src/app/api/inside/students/moderate/route.ts";
const LOGIN_ROUTE = "src/app/api/auth/login/route.ts";
const SUBMIT_ROUTE = "src/app/api/feedback/route.ts";
const SUSPENSION_ROUTE = "src/app/api/account/suspension/route.ts";
const ACCOUNT_STATE_ROUTE = "src/app/api/account/state/route.ts";
const PRODUCT_STATE = "src/lib/auth/product-state.ts";
const SUSPENSION_LIB = "src/lib/auth/suspension.ts";
const CLIENT = "src/app/inside/inside-client.tsx";

describe("suspension amendment — reason validation (live unit)", () => {
  it("bound is 280", () => {
    assert.equal(SUSPENSION_REASON_MAX, 280);
  });

  it("rejects missing/blank reasons", () => {
    assert.ok(validateSuspensionReason(undefined));
    assert.ok(validateSuspensionReason(null));
    assert.ok(validateSuspensionReason(""));
    assert.ok(validateSuspensionReason("   "));
  });

  it("rejects oversize reasons", () => {
    assert.ok(validateSuspensionReason("x".repeat(281)));
  });

  it("accepts a normal reason", () => {
    assert.equal(validateSuspensionReason("Repeated spam reports from three students."), null);
    assert.equal(validateSuspensionReason("x".repeat(280)), null);
  });
});

describe("suspension amendment — migration extends the schema in place", () => {
  it("migration file exists", () => {
    assert.ok(existsSync(new URL(MIG, ROOT)), "migration file must exist");
  });

  it("adds current-suspension state to profiles (no history table)", () => {
    const body = code(src(MIG));
    for (const col of ["suspension_reason", "suspended_at", "suspended_by"]) {
      assert.ok(body.includes(col), `profiles must gain ${col}`);
    }
    assert.ok(!/create\s+table/i.test(body), "no second suspensions table");
    assert.ok(body.includes("references auth.users"), "suspended_by references auth.users");
  });

  it("bounds the reason at the DB level and ties metadata to is_active", () => {
    const body = code(src(MIG));
    assert.ok(body.includes("char_length(suspension_reason) between 1 and 280"), "reason length CHECK required");
    assert.ok(body.includes("profiles_suspension_state_check"), "state invariant CHECK required");
  });

  it("adds the appeal link to feedback (no separate appeal system)", () => {
    const body = code(src(MIG));
    assert.ok(body.includes("suspension_related"), "appeal flag required");
    assert.ok(body.includes("related_suspension_at"), "appeal timestamp required");
    assert.ok(body.includes("feedback_suspension_link_check"), "link invariant CHECK required");
    assert.ok(!body.includes("suspension_id"), "no fake suspension id: state lives on profiles");
  });

  it("writer takes a reason, derives actor/timestamp, clears on restore", () => {
    const body = code(src(MIG));
    const i = body.indexOf("function public.admin_set_student_active(");
    assert.ok(i >= 0, "writer must exist");
    const block = body.slice(i, i + 4200);
    assert.ok(block.includes("p_reason"), "writer must accept a reason");
    assert.ok(block.includes("suspension reason is required"), "suspend must require a reason");
    assert.ok(block.includes("suspended_by = auth.uid()"), "actor comes from the caller JWT, never a parameter");
    assert.ok(block.includes("suspension_reason = null"), "restore must clear the reason");
    assert.ok(block.includes("suspended_at = null"), "restore must clear the timestamp");
    assert.ok(block.includes("suspended_by = null"), "restore must clear the actor");
  });

  it("listing RPCs expose suspension context, all RPCs re-check is_admin()", () => {
    const body = code(src(MIG));
    assert.ok(body.includes("p.suspension_reason as suspension_reason"), "student listing must return the reason");
    assert.ok(body.includes("author_suspension_reason"), "feedback listing must return the appeal cause");
    const guards = body.match(/if not public\.is_admin\(\) then/g) ?? [];
    assert.ok(guards.length >= 3, `every RPC must re-check is_admin(), found ${guards.length}`);
  });

  it("grants EXECUTE to authenticated only, never reads auth.users rows", () => {
    const body = code(src(MIG));
    assert.ok(!/grant execute[^;]*to\s+anon/i.test(body), "no anon EXECUTE grants");
    assert.ok(!/auth\.users/i.test(body.replace(/references auth\.users/g, "")), "auth.users rows must never be read");
  });

  it("historical Step 3 migrations are untouched", () => {
    for (const m of [
      "supabase/migrations/20261011000001_inside_students_moderation.sql",
      "supabase/migrations/20261014000001_feedback_admin_replies.sql",
      "supabase/migrations/20261013000001_inside_dashboard_refinement.sql",
    ]) {
      assert.ok(!src(m).includes("suspension_reason"), `${m} must stay untouched`);
    }
  });
});

describe("suspension amendment — suspend requires a reason, restore clears", () => {
  it("moderate route validates the reason and forwards it to the writer", () => {
    const body = code(src(MODERATE_ROUTE));
    assert.ok(body.includes("validateSuspensionReason"), "must validate server-side");
    assert.ok(body.includes("status: 400"), "blank/oversize reasons must be rejected");
    assert.ok(body.includes("p_reason"), "must pass the reason to the writer");
    assert.ok(!body.includes("suspended_by"), "route must not set the actor itself");
    assert.ok(!/suspended_at/.test(body), "route must not set the timestamp itself");
  });

  it("audit still records suspend/restore with the reason, history untouched", () => {
    const body = code(src(MODERATE_ROUTE));
    assert.ok(body.includes('"STUDENT_SUSPENDED"') && body.includes('"STUDENT_RESTORED"'));
    assert.ok(body.includes("reason: cleanReason"), "suspend audit must carry the reason");
    assert.ok(!body.includes(".delete("), "audit history is never deleted");
  });

  it("fail-closed compensation re-supplies a reason when re-suspending", () => {
    const body = code(src(MODERATE_ROUTE));
    assert.ok(body.includes("restoring previous state"), "must compensate");
    assert.ok(body.includes("priorReason"), "restore compensation must remember the pre-restore reason");
  });

  it("admin UI confirms with a reason form (no one-click suspend)", () => {
    const body = code(src(CLIENT));
    assert.ok(!body.includes("window.confirm(`Suspend"), "confirm() suspend must be gone");
    assert.ok(body.includes("why are you suspending"), "inline reason prompt required");
    assert.ok(body.includes("confirm suspension"), "explicit confirm action required");
    assert.ok(body.includes("Tell the student why they're suspended."), "blank reasons rejected client-side too");
  });

  it("report-queue suspends also require a reason", () => {
    const body = code(src(CLIENT));
    const i = body.indexOf("async function suspendReported(");
    assert.ok(i >= 0);
    const block = body.slice(i, i + 2000);
    assert.ok(block.includes("reason"), "queue suspend must send the reason");
    assert.ok(body.includes("report-suspend-reason-"), "queue suspend must ask for a reason");
    assert.ok(!block.includes("report ${report.id}"), "report id is not a suspension reason");
  });

  it("directory shows the reason on suspended rows only", () => {
    const body = code(src(CLIENT));
    assert.ok(body.includes("Reason: {s.suspension_reason}"), "suspended rows must show the reason");
    assert.ok(body.includes("suspension_reason: string | null"), "row type must carry the reason");
  });
});

describe("suspension amendment — login + central guard enforcement", () => {
  it("login checks suspension server-side in the shared tail (both paths)", () => {
    const body = code(src(LOGIN_ROUTE));
    assert.ok(body.includes('select("is_active, suspension_reason")'), "must read live suspension state");
    assert.ok(body.includes("suspended: true"), "must return a dedicated suspended state");
    assert.ok(body.includes("status: 403"), "suspended login must be refused");
    // Both identifier paths funnel through one tail: exactly one suspension
    // gate, and it runs before any destination is computed.
    const gates = body.match(/is_active === false/g) ?? [];
    assert.equal(gates.length, 1, "one shared suspension gate for both login paths");
    const gateAt = body.indexOf("is_active === false");
    const destAt = body.indexOf("getOnboardingState(user,");
    assert.ok(gateAt >= 0 && destAt > gateAt, "no normal destination may resolve for a suspended account");
  });

  it("suspended login returns the user's own reason, never generic-only", () => {
    const body = code(src(LOGIN_ROUTE));
    assert.ok(body.includes("reason: typeof state.suspension_reason"), "own reason must be returned");
    // The suspended branch keeps the session (the appeal path needs auth);
    // sign-outs elsewhere are the pre-existing mismatch defenses.
    const gateAt = body.indexOf("is_active === false");
    const tailAt = body.indexOf("getOnboardingState(user,", gateAt);
    const branch = body.slice(gateAt, tailAt);
    assert.ok(!branch.includes("signOut"), "suspended branch must not sign out (appeals need auth)");
  });

  it("login page routes suspended sessions to the dedicated screen", () => {
    const body = code(src("src/app/login/page.tsx"));
    assert.ok(body.includes('j?.suspended === true'), "must detect the suspended response");
    assert.ok(body.includes('"/suspended"'), "must route to the dedicated screen");
  });

  it("product session carries suspension; guard redirects to /suspended", () => {
    const body = code(src(PRODUCT_STATE));
    assert.ok(body.includes("suspended: boolean"), "session must carry the flag");
    assert.ok(body.includes('return "/suspended"'), "guard must redirect suspended users");
    assert.ok(body.includes("allowSuspended"), "appeal path must opt in explicitly");
  });

  it("protected APIs refuse suspended accounts without leaking the reason", () => {
    for (const rel of ["src/app/api/search/route.ts", "src/app/api/invite/route.ts"]) {
      const body = code(src(rel));
      assert.ok(body.includes("session.suspended"), `${rel} must distinguish suspension`);
      assert.ok(body.includes("status: 403"), `${rel} must refuse with 403`);
      assert.ok(!body.includes("suspension_reason"), `${rel} must not leak the reason`);
    }
  });
});

describe("suspension amendment — suspended screen + own-reason API", () => {
  it("suspension API returns the caller's own state only", () => {
    const body = code(src(SUSPENSION_ROUTE));
    assert.ok(body.includes("supabase.auth.getUser()"), "must authenticate");
    assert.ok(body.includes("status: 401"), "must refuse anonymous callers");
    assert.ok(body.includes("suspension_reason"), "must return the own reason");
    assert.ok(!/userId|target/i.test(body), "no target parameter: nobody reads another user's reason");
  });

  it("suspended page is allowlisted, shows reason, links the appeal flow", () => {
    const body = code(src("src/app/suspended/page.tsx"));
    assert.ok(body.includes("allowSuspended: true"), "page must admit suspended sessions");
    assert.ok(body.includes("suspension_reason"), "must show the own reason");
    assert.ok(body.includes('"/feedback?appeal=1"'), "must link the appeal flow");
    assert.ok(body.includes("contact us"), "appeal entry must read contact us");
    assert.ok(!body.includes("is_anonymous"), "must not derive nav from raw anonymity");
  });

  it("account state exposes a routing boolean only — never the reason", () => {
    const body = code(src(ACCOUNT_STATE_ROUTE));
    assert.ok(body.includes("suspended"), "must expose the routing flag");
    assert.ok(!body.includes("suspension_reason"), "must never expose the reason");
  });
});

describe("suspension amendment — appeal feedback stays one system", () => {
  it("feedback page admits suspended users; client presets ACCOUNT on appeal entry", () => {
    assert.ok(code(src("src/app/feedback/page.tsx")).includes("allowSuspended: true"), "appeal path must stay open");
    const client = code(src("src/app/feedback/client.tsx"));
    assert.ok(client.includes('searchParams.get("appeal")'), "must detect the appeal entry");
    assert.ok(client.includes('"ACCOUNT"'), "appeal entry must preset the account category");
  });

  it("appeal link is server-derived; client context is never authoritative", () => {
    const body = code(src(SUBMIT_ROUTE));
    assert.ok(body.includes("suspension_related"), "must persist the appeal link");
    assert.ok(body.includes("related_suspension_at"), "must pin the suspension moment");
    assert.ok(body.includes("is_active === false"), "suspension is read from the live profile");
    assert.ok(!/body\??\.\s*(suspension_related|appeal|suspended)/i.test(body), "must never read appeal context from the client");
  });

  it("own feedback history exposes no moderation context", () => {
    const body = code(src(SUBMIT_ROUTE));
    const getAt = body.indexOf("export async function GET()");
    const block = body.slice(getAt, getAt + 1200);
    assert.ok(!block.includes("suspension"), "history must not expose moderation context");
  });

  it("admin inbox flags appeals with their cause in one place", () => {
    const body = code(src(CLIENT));
    const i = body.indexOf("function FeedbackPanel()");
    const block = body.slice(i, i + 16000);
    assert.ok(block.includes("suspension appeal"), "appeal badge required");
    assert.ok(block.includes("Reason for suspension:"), "cause must render with the appeal");
    assert.ok(block.includes("author_suspension_reason"), "cause must come from the server listing");
  });

  it("no auto-restore: appeal submission changes no suspension state", () => {
    const body = code(src(SUBMIT_ROUTE));
    // The route READS is_active to derive the appeal link — it must never
    // WRITE suspension state.
    assert.ok(!body.includes(".update("), "submission must not update anything");
    assert.ok(!body.includes("admin_set_student_active"), "submission must not moderate");
  });
});

describe("suspension amendment — privacy (reason stays out of public surfaces)", () => {
  it("no public projection selects suspension columns", () => {
    for (const rel of [
      "src/app/api/search/route.ts",
      "src/app/u/[username]/page.tsx",
      "src/app/api/invite/route.ts",
      "src/app/api/account/state/route.ts",
      "src/app/api/profile/route.ts",
    ]) {
      const body = code(src(rel));
      assert.ok(!body.includes("suspension_reason"), `no reason in ${rel}`);
      assert.ok(!body.includes("suspended_by"), `no actor in ${rel}`);
    }
    const mig = code(src(MIG));
    const rpcStart = mig.indexOf("function public.admin_list_students(");
    assert.ok(!mig.slice(0, rpcStart).includes("discover"), "migration must not touch discover");
  });

  it("audit carries the reason, never email content", () => {
    const body = code(src(MODERATE_ROUTE));
    const i = body.indexOf("await recordInsideAuditEvent");
    const block = body.slice(i, i + 400);
    assert.ok(block.includes("reason"), "suspend audit must carry the reason");
    assert.ok(!/admin_reply|message|email/i.test(block), "no email content in audit metadata");
  });
});

describe("suspension amendment — scope stays tight", () => {
  it("no suspension history UI, expiry, voting, or notification machinery", () => {
    const banned = [
      "suspension_history",
      "expires_at",
      "temporary",
      "appeal_vote",
      "auto_restore",
      "notification",
      "campaign",
      "broadcast",
    ];
    for (const rel of [MIG, MODERATE_ROUTE, LOGIN_ROUTE, SUBMIT_ROUTE, SUSPENSION_ROUTE, SUSPENSION_LIB, "src/app/suspended/page.tsx"]) {
      const body = code(src(rel)).toLowerCase();
      for (const b of banned) {
        assert.ok(!body.includes(b), `no ${b} machinery in ${rel}`);
      }
    }
  });

  it("no launch machinery returns", () => {
    for (const rel of [MIG, MODERATE_ROUTE, LOGIN_ROUTE, SUBMIT_ROUTE]) {
      const body = code(src(rel));
      assert.ok(!/LAUNCH_ENABLED|admin_set_launch/.test(body), `no launch references in ${rel}`);
    }
  });
});
