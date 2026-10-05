import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

/**
 * Static regression guards for `/inside` Step 3 (students + moderation).
 *
 * The route handlers depend on Next/Supabase request contexts and the
 * tables live in the database, so live row-level behaviors (list/search
 * as admin, 403s as student/anon, suspend/restore flips, resolve flows,
 * audit attribution) are verified against staging in the manual checklist.
 * These tests guard the properties that MUST hold in source: the migration
 * reuses is_active/reports.status instead of new fields, every privileged
 * path reuses requireInsideAdmin() + is_admin() with no client-supplied
 * actor, no-ops record no audit event, failed mutations record nothing,
 * fail-closed compensation is wired, and no secrets reach responses or
 * audit metadata.
 */

const ROOT = new URL("../../../", import.meta.url);
const MIG = "supabase/migrations/20261011000001_inside_students_moderation.sql";

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

const STUDENTS_ROUTE = "src/app/api/inside/students/route.ts";
const MODERATE_ROUTE = "src/app/api/inside/students/moderate/route.ts";
const REPORTS_ROUTE = "src/app/api/inside/reports/route.ts";
const RESOLVE_ROUTE = "src/app/api/inside/reports/resolve/route.ts";

describe("inside step 3 — migration exists and reuses existing schema", () => {
  it("migration file exists", () => {
    assert.ok(existsSync(new URL(MIG, ROOT)), "migration file must exist");
  });

  it("reuses profiles.is_active for suspension (no new status field)", () => {
    const body = code(src(MIG));
    assert.ok(body.includes("is_active"), "must reuse profiles.is_active");
    assert.ok(
      !/add\s+column/i.test(body),
      "no new columns: suspension reuses is_active",
    );
  });

  it("reuses reports.status for resolution (no duplicate table)", () => {
    const body = code(src(MIG));
    assert.ok(!/create\s+table/i.test(body), "no new tables of any kind");
    assert.ok(body.includes("admin_resolve_report"), "resolver must exist");
  });

  it("extends the audit CHECK with exactly the three Step 3 actions", () => {
    const body = code(src(MIG));
    const i = body.indexOf("inside_audit_events_action_check");
    assert.ok(i >= 0, "CHECK constraint must be touched");
    const block = body.slice(i, i + 900);
    for (const a of ["STUDENT_SUSPENDED", "STUDENT_RESTORED", "REPORT_RESOLVED"]) {
      assert.ok(block.includes(`'${a}'`), `CHECK must allow ${a}`);
    }
    // The six Step 2 actions are kept.
    for (const a of ["ADMIN_LOGIN_SUCCESS", "LAUNCH_ENABLED", "LAUNCH_VERSION_CHANGED"]) {
      assert.ok(block.includes(`'${a}'`), `CHECK must keep ${a}`);
    }
  });

  it("creates the four admin RPCs, all guarded by is_admin()", () => {
    const body = code(src(MIG));
    for (const fn of [
      "admin_list_students",
      "admin_set_student_active",
      "admin_list_reports",
      "admin_resolve_report",
    ]) {
      assert.ok(body.includes(`function public.${fn}(`), `${fn} must exist`);
    }
    const guards = body.match(/if not public\.is_admin\(\) then/g) ?? [];
    assert.ok(guards.length >= 4, `every RPC must re-check is_admin(), found ${guards.length}`);
  });

  it("grants EXECUTE to authenticated only (students can call but are refused)", () => {
    const body = code(src(MIG));
    assert.ok(!/grant execute[^;]*to\s+anon/i.test(body), "no anon EXECUTE grants");
    const grants = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("--"))
      .filter((l) => /grant execute/i.test(l));
    assert.ok(grants.length >= 4, "each RPC needs an explicit grant");
    for (const g of grants) {
      assert.ok(/to authenticated/.test(g), `grant must target authenticated only: ${g}`);
    }
    assert.ok(/revoke all on function/i.test(body), "public must be revoked");
  });

  it("never reads auth.users (no passwords/tokens/auth internals reachable)", () => {
    const body = code(src(MIG));
    assert.ok(!/auth\.users/i.test(body), "auth.users must never be touched");
    assert.ok(!/encrypted_password|service_role|recovery_token/i.test(body));
  });

  it("searches username/nickname/USN with bounded pagination", () => {
    const body = code(src(MIG));
    assert.ok(body.includes("username ilike"), "username search required");
    assert.ok(body.includes("nickname ilike"), "nickname search required");
    assert.ok(body.includes("usn ilike"), "USN search required");
    assert.ok(body.includes("least(greatest(coalesce(p_limit"), "limit must be clamped");
  });

  it("mutation RPCs report previous/new state plus a no-op changed flag", () => {
    const body = code(src(MIG));
    assert.ok(body.includes("previous_active") && body.includes("'changed', false"));
    assert.ok(body.includes("previous_status") && body.includes("'changed', true"));
  });

  it("list RPCs keep CTEs in a single statement (staging 42P01 regression)", () => {
    // CTEs live for exactly one statement: the first Step 3 migration
    // counted in one statement and paged in a second, which raised
    // `relation "filtered" does not exist` on staging. The fix migration
    // resolves total + page in one statement and is authoritative.
    const fix = "supabase/migrations/20261011000002_inside_students_moderation_fix.sql";
    assert.ok(existsSync(new URL(fix, ROOT)), "fix migration must exist");
    const body = code(src(fix));
    assert.ok(!/select count\(\*\) into/i.test(body), "no two-step COUNT");
    assert.ok(body.includes("into v_result"), "single INTO of the combined object");
    for (const fn of ["admin_list_students", "admin_list_reports"]) {
      assert.ok(body.includes(`function public.${fn}(`), `${fn} redefined by the fix`);
    }
  });
});

describe("inside step 3 — route authorization (non-admin/anon cannot)", () => {
  for (const rel of [STUDENTS_ROUTE, MODERATE_ROUTE, REPORTS_ROUTE, RESOLVE_ROUTE]) {
    it(`${rel} reuses requireInsideAdmin() and refuses with 403`, () => {
      const body = code(src(rel));
      assert.ok(body.includes("requireInsideAdmin()"), `${rel} must check the gate`);
      assert.ok(body.includes("status: 403"), `${rel} must refuse with 403`);
    });
  }

  it("state-changing routes enforce the Origin check", () => {
    for (const rel of [MODERATE_ROUTE, RESOLVE_ROUTE]) {
      assert.ok(code(src(rel)).includes("verifySameOrigin"), `${rel} must check Origin`);
    }
  });

  it("no route accepts an actor from the browser", () => {
    for (const rel of [STUDENTS_ROUTE, MODERATE_ROUTE, REPORTS_ROUTE, RESOLVE_ROUTE]) {
      const body = code(src(rel));
      assert.ok(!body.includes("actor_user_id"), `no actor field in ${rel}`);
      assert.ok(!/recordInside\w+\([^)]*actor/i.test(body), `no actor argument in ${rel}`);
    }
  });

  it("moderation/resolve mutations go through is_admin()-checked RPCs only", () => {
    assert.ok(code(src(MODERATE_ROUTE)).includes("admin_set_student_active"));
    assert.ok(code(src(RESOLVE_ROUTE)).includes("admin_resolve_report"));
    // No direct table writes on the happy path. The resolve route's single
    // compensation update (fail-closed rollback) is asserted separately.
    assert.ok(!code(src(MODERATE_ROUTE)).includes(".update("));
    const resolveBody = code(src(RESOLVE_ROUTE));
    const updates = [...resolveBody.matchAll(/\.update\(/g)];
    assert.equal(updates.length, 1, "resolve may update only in compensation");
    const i = resolveBody.indexOf(".update(");
    assert.ok(
      resolveBody.slice(Math.max(0, i - 300), i).includes("restoring previous state"),
      "the single update must serve compensation only",
    );
    for (const rel of [MODERATE_ROUTE, RESOLVE_ROUTE]) {
      assert.ok(!code(src(rel)).includes(".delete("), `${rel} must not delete`);
    }
  });
});

describe("inside step 3 — audit coverage (actor/target/no-op/fail-closed)", () => {
  it("audit action set includes the three Step 3 actions", () => {
    const body = code(src("src/lib/inside/audit.ts"));
    for (const a of ["STUDENT_SUSPENDED", "STUDENT_RESTORED", "REPORT_RESOLVED"]) {
      assert.ok(body.includes(`"${a}"`), `action set must include ${a}`);
    }
  });

  it("moderate route audits suspend/restore with the student as target", () => {
    const body = code(src(MODERATE_ROUTE));
    assert.ok(body.includes('"STUDENT_SUSPENDED"'));
    assert.ok(body.includes('"STUDENT_RESTORED"'));
    assert.ok(body.includes('targetType: "student"'), "target must be the student");
    assert.ok(body.includes("previous_active") && body.includes("new_active"));
  });

  it("resolve route audits REPORT_RESOLVED with the report as target", () => {
    const body = code(src(RESOLVE_ROUTE));
    assert.ok(body.includes('"REPORT_RESOLVED"'));
    assert.ok(body.includes('targetType: "report"'), "target must be the report");
    assert.ok(body.includes("previous_status") && body.includes("new_status"));
  });

  it("resolve-with-moderation records a second explicit student event", () => {
    const body = code(src(RESOLVE_ROUTE));
    assert.ok(body.includes('"STUDENT_SUSPENDED"') || body.includes("STUDENT_RESTORED"));
    assert.ok(body.includes("admin_set_student_active"), "must reuse the student writer");
  });

  it("no-op calls record no audit event", () => {
    for (const rel of [MODERATE_ROUTE, RESOLVE_ROUTE]) {
      const body = code(src(rel));
      assert.ok(body.includes("changed !== true"), `${rel} must guard on the changed flag`);
      const guardAt = body.indexOf("changed !== true");
      const auditAt = body.indexOf("await recordInsideAuditEvent");
      assert.ok(guardAt >= 0 && auditAt > guardAt, `${rel} must return before auditing a no-op`);
    }
  });

  it("failed/unauthorized mutations record no success event", () => {
    for (const rel of [MODERATE_ROUTE, RESOLVE_ROUTE]) {
      const body = code(src(rel));
      const firstError = body.indexOf("status: 500");
      const firstAudit = body.indexOf("await recordInsideAuditEvent");
      assert.ok(firstError >= 0 && firstAudit > firstError, `${rel}: errors return before any audit`);
    }
  });

  it("audit failure restores state and returns 500 (fail closed)", () => {
    for (const rel of [MODERATE_ROUTE, RESOLVE_ROUTE]) {
      const body = code(src(rel));
      assert.ok(body.includes("!") && body.includes(".ok"), `${rel} must check the audit result`);
      assert.ok(body.includes("restoring previous state"), `${rel} must compensate`);
      const i = body.indexOf("restoring previous state");
      assert.ok(body.slice(i, i + 600).includes("status: 500"), `${rel} must 500, never silent success`);
    }
  });

  it("audit events carry only ids/state/reason — no secrets or private fields", () => {
    const ALLOWED_KEYS = new Set([
      "targetType",
      "targetId",
      "metadata",
      "previous_active",
      "new_active",
      "previous_status",
      "new_status",
      "reported_id",
      "report_id",
      "reason",
    ]);
    for (const rel of [MODERATE_ROUTE, RESOLVE_ROUTE]) {
      const lines = code(src(rel)).split("\n");
      // Bound each inspection to the audit call expression itself (the
      // lines up to its closing `);`), so later compensation code cannot
      // trip the check.
      for (let n = 0; n < lines.length; n++) {
        if (!lines[n].includes("recordInsideAuditEvent(")) continue;
        let m = n;
        // Audit calls close as `});` (inline) or `);` (multi-line) —
        // either ends the inspected expression.
        while (m < lines.length && lines[m].trim() !== ");" && lines[m].trim() !== "});") m++;
        assert.ok(m < lines.length, `audit call must close in ${rel}`);
        const call = lines.slice(n, m + 1).join("\n");
        assert.ok(
          !/passw|adminkey|admin_key|smtp|session[-_ ]?token|recovery[-_ ]?token|\busn\b|\bemail\b/i.test(
            call,
          ),
          `no secrets or private identifiers in audit call in ${rel}`,
        );
        for (const k of call.matchAll(/(\w+):/g)) {
          assert.ok(ALLOWED_KEYS.has(k[1]), `unexpected audit key ${k[1]} in ${rel}`);
        }
      }
    }
  });

  it("moderation reason is short, optional, and audit-metadata-only", () => {
    for (const rel of [MODERATE_ROUTE, RESOLVE_ROUTE]) {
      const body = code(src(rel));
      assert.ok(body.includes("MAX_REASON") || body.includes("280"), `${rel} must bound the reason`);
      // The reason never reaches a table write — only the audit metadata.
      assert.ok(!/\.insert\(\s*\{[^}]*reason/i.test(body), `${rel}: reason must not be inserted`);
    }
  });
});

describe("inside step 3 — validation and response hygiene", () => {
  it("moderate validates the action enum", () => {
    const body = code(src(MODERATE_ROUTE));
    assert.ok(body.includes('"suspend"') && body.includes('"restore"'));
    assert.ok(body.includes("status: 400"));
  });

  it("resolve validates resolution/moderate enums", () => {
    const body = code(src(RESOLVE_ROUTE));
    assert.ok(body.includes('"resolved"') && body.includes('"dismissed"'));
    assert.ok(body.includes("status: 400"));
  });

  it("list routes clamp input and return bounded shapes", () => {
    for (const rel of [STUDENTS_ROUTE, REPORTS_ROUTE]) {
      const body = code(src(rel));
      assert.ok(body.includes("p_limit") && body.includes("p_offset"));
    }
    assert.ok(code(src(STUDENTS_ROUTE)).includes("students"));
    assert.ok(code(src(STUDENTS_ROUTE)).includes("total"));
    assert.ok(code(src(REPORTS_ROUTE)).includes("reports"));
    assert.ok(code(src(REPORTS_ROUTE)).includes("total"));
  });

  it("step 1/2 architecture is preserved (no parallel systems)", () => {
    const helper = code(src("src/lib/inside/audit.ts"));
    assert.ok(!helper.includes("STUDENT_BANNED"), "no ad-hoc action names");
    // Only the resolve compensation path may use service-role (report
    // status can only move forward through the sanctioned resolver, so
    // rollback needs the privileged client); moderation compensates
    // through the same sanctioned writer.
    assert.ok(!code(src(MODERATE_ROUTE)).includes("createServiceRoleClient"));
    const resolveBody = code(src(RESOLVE_ROUTE));
    assert.ok(resolveBody.includes("createServiceRoleClient"));
    // The import line also names it — inspect the usage, not the import.
    const i = resolveBody.lastIndexOf("createServiceRoleClient");
    assert.ok(
      resolveBody.slice(Math.max(0, i - 400), i).includes("restoring previous state"),
      "service-role in resolve must serve compensation only",
    );
  });
});
