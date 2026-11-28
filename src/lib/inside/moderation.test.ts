import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseReportModeration,
  cleanSuspensionReason,
} from "./report-moderation.ts";

const ROOT = new URL("../../../", import.meta.url);
const MIGRATION = "supabase/migrations/20261128000001_atomic_report_moderation.sql";
const MODERATE_ROUTE = "src/app/api/inside/students/moderate/route.ts";
const RESOLVE_ROUTE = "src/app/api/inside/reports/resolve/route.ts";

function src(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8");
}
function code(body: string): string {
  return body.split("\n").filter((line) => {
    const value = line.trim();
    return !value.startsWith("--") && !value.startsWith("//") &&
      !value.startsWith("*") && !value.startsWith("/*");
  }).join("\n");
}

describe("atomic moderation database writers", () => {
  it("ships the atomic migration", () => {
    assert.ok(src(MIGRATION).includes("admin_resolve_report_with_moderation"));
    assert.ok(src(MIGRATION).includes("admin_set_student_active_audited"));
  });

  it("locks report and student rows before changing either", () => {
    const migration = code(src(MIGRATION));
    assert.match(migration, /from public\.reports[\s\S]*?for update/i);
    assert.match(migration, /from public\.profiles[\s\S]*?for update/i);
  });

  it("writes report and moderation audit events inside the transaction", () => {
    const migration = code(src(MIGRATION));
    assert.match(migration, /insert into public\.inside_audit_events[\s\S]*?'REPORT_RESOLVED'/);
    assert.match(migration, /'STUDENT_SUSPENDED'/);
    assert.match(migration, /'STUDENT_RESTORED'/);
  });

  it("restricts both RPCs to service_role and checks the server actor", () => {
    const migration = code(src(MIGRATION));
    assert.match(migration, /not exists\s*\(\s*select 1 from public\.admin_users/i);
    assert.match(migration, /to service_role/i);
    assert.match(migration, /from public, anon, authenticated/i);
  });

  it("routes use atomic RPCs and do not perform separate audit/compensation writes", () => {
    const moderate = code(src(MODERATE_ROUTE));
    const resolve = code(src(RESOLVE_ROUTE));
    assert.ok(moderate.includes("admin_set_student_active_audited"));
    assert.ok(resolve.includes("admin_resolve_report_with_moderation"));
    for (const body of [moderate, resolve]) {
      assert.ok(!body.includes("recordInsideAuditEvent"));
      assert.ok(!body.includes(".update("));
    }
  });
});

describe("moderation request validation", () => {
  it("accepts only omitted/suspend/restore", () => {
    assert.deepEqual(parseReportModeration(undefined), { ok: true, mode: null });
    assert.deepEqual(parseReportModeration("suspend"), { ok: true, mode: "suspend" });
    assert.deepEqual(parseReportModeration("restore"), { ok: true, mode: "restore" });
    assert.equal(parseReportModeration("ban").ok, false);
  });

  it("cleans and bounds suspension reasons", () => {
    assert.equal(cleanSuspensionReason("  unsafe  ", 280), "unsafe");
    assert.equal(cleanSuspensionReason("   ", 280), null);
    assert.equal(cleanSuspensionReason(null, 280), null);
    assert.equal(cleanSuspensionReason("abcdef", 3), "abc");
  });

  it("keeps admin authorization, origin checks, and reason validation", () => {
    for (const path of [MODERATE_ROUTE, RESOLVE_ROUTE]) {
      const body = code(src(path));
      assert.ok(body.includes("requireInsideAdmin()"));
      assert.ok(body.includes("verifySameOrigin"));
      assert.ok(body.includes("insideMutationRateLimit"));
    }
    assert.ok(code(src(MODERATE_ROUTE)).includes("validateSuspensionReason"));
    assert.ok(code(src(RESOLVE_ROUTE)).includes("validateSuspensionReason"));
  });
});
