import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("inside service-role admin actor boundary", () => {
  it("passes only the verified gate actor to dashboard RPCs", () => {
    const routes = [
      "src/app/inside/page.tsx",
      "src/app/api/inside/students/route.ts",
      "src/app/api/inside/feedback/route.ts",
      "src/app/api/inside/reports/route.ts",
      "src/app/api/inside/email-queue/route.ts",
      "src/app/api/inside/students/moderate/route.ts",
      "src/app/api/inside/reports/resolve/route.ts",
      "src/app/api/inside/feedback/resolve/route.ts",
    ];
    for (const path of routes) {
      const body = read(path);
      assert.ok(body.includes("requireInsideAdmin()"), `${path} must gate first`);
      assert.ok(body.includes("createServiceRoleClient"), `${path} must use service role`);
      assert.ok(body.includes("p_actor_id: gate.userId"), `${path} must bind the actor`);
      assert.ok(!body.includes("p_actor_id: parsed"), `${path} must not trust request actor input`);
    }
  });

  it("wraps every migrated dashboard RPC with live admin membership validation", () => {
    const migration = read("supabase/migrations/20261123000005_inside_admin_service_actor.sql");
    for (const name of [
      "admin_overview_counts",
      "admin_list_students",
      "admin_list_reports",
      "admin_list_feedback",
      "admin_waitlist_email_queue_summary",
      "admin_prepare_waitlist_email_queue",
      "admin_set_student_active",
      "admin_resolve_report",
      "admin_resolve_feedback",
    ]) {
      assert.ok(migration.includes(`create or replace function public.${name}(`), name);
    }
    assert.equal((migration.match(/inside_admin_actor_ok\(p_actor_id\)/g) ?? []).length, 0);
    assert.ok(!migration.includes("set_config('request.jwt.claim.sub'"));
    for (const name of [
      "admin_overview_counts", "admin_list_students", "admin_list_reports",
      "admin_list_feedback", "admin_waitlist_email_queue_summary",
      "admin_prepare_waitlist_email_queue", "admin_set_student_active",
      "admin_resolve_report", "admin_resolve_feedback",
    ]) {
      assert.ok(!migration.includes(`return public.inside_${name}_body`), `${name} must not delegate`);
    }
    assert.ok(migration.includes("grant execute on function public.admin_overview_counts(uuid) to service_role"));
    assert.ok(!migration.includes("grant execute on function public.admin_overview_counts(uuid) to authenticated"));
  });
});
