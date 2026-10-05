import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

/**
 * Static regression guards for the `/inside` dashboard refinement
 * (permanent admin/operations dashboard: WAITING + SUSPENDED overview,
 * student directory with email search + status filter + auto-load).
 *
 * Live row-level behaviors (counts as admin, 403s as student/anon,
 * suspend/restore flips) run against staging; these tests guard the
 * properties that MUST hold in source: the overview exposes exactly the
 * operational metrics with one authoritative waiting definition, suspended
 * students are never counted as waiting, email search + status filtering
 * happen server-side, the directory auto-loads, and no launch state or
 * email-presence machinery is introduced.
 */

const ROOT = new URL("../../../", import.meta.url);
const MIG = "supabase/migrations/20261013000001_inside_dashboard_refinement.sql";

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

const PAGE = "src/app/inside/page.tsx";
const CLIENT = "src/app/inside/inside-client.tsx";
const STUDENTS_ROUTE = "src/app/api/inside/students/route.ts";

describe("inside dashboard — refinement migration", () => {
  it("migration file exists and historical migrations are untouched", () => {
    assert.ok(existsSync(new URL(MIG, ROOT)), "refinement migration must exist");
  });

  it("overview returns exactly waiting + suspended (no total_users)", () => {
    const body = code(src(MIG));
    const i = body.indexOf("function public.admin_overview_counts()");
    assert.ok(i >= 0, "must redefine admin_overview_counts()");
    const block = body.slice(i, i + 1600);
    assert.ok(block.includes("'waiting'"), "must return waiting");
    assert.ok(block.includes("'suspended'"), "must return suspended");
    assert.ok(!block.includes("total_users"), "total_users must be dropped from the contract");
    assert.ok(!block.includes("verification_records"), "overview must not count verification_records");
  });

  it("waiting is active photo-complete profiles; suspended is is_active = false", () => {
    const body = code(src(MIG));
    const i = body.indexOf("function public.admin_overview_counts()");
    const block = body.slice(i, i + 1600);
    assert.ok(block.includes("profile_photos"), "waiting requires a photo (onboarding-complete tail)");
    assert.ok(
      block.includes("is_active is distinct from false"),
      "waiting must exclude suspended profiles",
    );
    assert.ok(block.includes("is_active = false"), "suspended derives from is_active = false");
  });

  it("waiting matches the product completion tail (profile + photo)", () => {
    // getOnboardingState(): complete = real verified auth email + profile +
    // >= 1 photo. The email head lives in auth.users (unreadable by admin
    // RPCs by design); the SQL waiting leg is the profile/photo tail plus
    // the active gate. The client renders complete rows as "waiting".
    const state = code(src("src/lib/onboarding/state.ts"));
    assert.ok(state.includes("profile_photos"), "completion requires a photo");
    const client = code(src(CLIENT));
    assert.ok(
      client.includes('state === "complete" ? "waiting"'),
      "complete rows must read as waiting",
    );
  });

  it("both RPCs re-check is_admin() and grant EXECUTE to authenticated only", () => {
    const body = code(src(MIG));
    const guards = body.match(/if not public\.is_admin\(\) then/g) ?? [];
    assert.ok(guards.length >= 2, `every redefined RPC must re-check is_admin(), found ${guards.length}`);
    assert.ok(!/grant execute[^;]*to\s+anon/i.test(body), "no anon EXECUTE grants");
    const grants = body.split("\n").filter((l) => /grant execute/i.test(l));
    assert.ok(grants.length >= 2, "each RPC needs an explicit grant");
    for (const g of grants) {
      assert.ok(/to authenticated/.test(g), `grant must target authenticated only: ${g}`);
    }
    assert.ok(/revoke all on function/i.test(body), "public must be revoked");
  });

  it("adds no columns, tables, or status machinery (reuses is_active)", () => {
    const body = code(src(MIG));
    assert.ok(!/add\s+column/i.test(body), "no new columns");
    assert.ok(!/create\s+table/i.test(body), "no new tables");
    assert.ok(!/auth\.users/i.test(body), "auth.users must never be touched");
  });

  it("student listing searches email and filters by status server-side", () => {
    const body = code(src(MIG));
    const i = body.indexOf("function public.admin_list_students(");
    assert.ok(i >= 0, "must redefine admin_list_students()");
    const block = body.slice(i, i + 5200);
    assert.ok(block.includes("p_status"), "must accept a status filter");
    for (const s of ["'all'", "'active'", "'suspended'"]) {
      assert.ok(block.includes(s), `must support status ${s}`);
    }
    assert.ok(block.includes("invalid student status filter"), "must reject bad status values");
    assert.ok(block.includes("email ilike"), "must search email");
    assert.ok(block.includes("username ilike"), "username search preserved");
    assert.ok(block.includes("nickname ilike"), "nickname search preserved");
    assert.ok(block.includes("usn ilike"), "USN search preserved");
    assert.ok(block.includes("least(greatest(coalesce(p_limit"), "limit must stay clamped");
    assert.ok(block.includes("into v_result"), "single-statement total + page (no two-step COUNT)");
  });

  it("introduces no launch state and no email-presence machinery", () => {
    const body = code(src(MIG));
    for (const b of [
      "launch_config",
      "admin_set_launch",
      "getLaunchState",
      "guardLaunch",
      "launched",
    ]) {
      assert.ok(!body.includes(b), `no launch reference: ${b}`);
    }
    assert.ok(!body.includes("email_skipped"), "no email-presence column or filter");
  });
});

describe("inside dashboard — overview UI", () => {
  it("page resolves waiting + suspended and requires both for live counts", () => {
    const body = code(src(PAGE));
    assert.ok(!body.includes("total_users") && !body.includes("totalUsers"), "total_users card must be gone");
    assert.ok(body.includes("waiting") && body.includes("suspended"), "must resolve both metrics");
    assert.ok(body.includes("admin_overview_counts"), "must reuse the overview RPC");
  });

  it("dashboard renders WAITING and SUSPENDED cards only", () => {
    const body = code(src(CLIENT));
    assert.ok(body.includes(">waiting<"), "WAITING card required");
    assert.ok(body.includes(">suspended<"), "SUSPENDED card required");
    assert.ok(!body.includes("total users"), "total users card must be gone");
    assert.ok(body.includes("initial.waiting") && body.includes("initial.suspended"));
    assert.ok(!body.includes("initial.totalUsers"), "no totalUsers prop may remain");
  });

  it("panels are ordered students -> reports -> health", () => {
    const body = code(src(CLIENT));
    const s = body.indexOf("<StudentsPanel />");
    const r = body.indexOf("<ReportsPanel />");
    const h = body.indexOf("<HealthPanel />");
    assert.ok(s >= 0 && r >= 0 && h >= 0, "all three panels must render");
    assert.ok(s < r && r < h, "order must be students, reports, health");
  });

  it("reports stay unconditional with no launch condition", () => {
    const body = code(src(CLIENT));
    assert.ok(body.includes("<ReportsPanel />"), "reports must render unconditionally");
    assert.ok(!body.includes("launched"), "no launch state in the dashboard");
    assert.ok(!body.includes("/api/inside/launch"), "no launch control");
  });

  it("adds no email-presence UI and no launch references", () => {
    const body = code(src(CLIENT));
    // "no email yet" is a legitimate empty-state fallback on a row that
    // always renders the email field — not an email-presence metric. The
    // prohibited machinery is the legacy email_skipped flag.
    assert.ok(!body.includes("email_skipped"), "no email-presence metric or filter");
    for (const b of ["launch_config", "admin_set_launch", "getLaunchState", "launched"]) {
      assert.ok(!body.includes(b), `no launch reference: ${b}`);
    }
  });
});

describe("inside dashboard — student directory", () => {
  it("loads the first page automatically (no search required)", () => {
    const body = code(src(CLIENT));
    const i = body.indexOf("function StudentsPanel()");
    assert.ok(i >= 0);
    const block = body.slice(i, i + 2600);
    assert.ok(block.includes("useEffect"), "must auto-load on mount");
    assert.ok(/fetchStudentsPage\(0, "", "all"\)/.test(block), "must load page one with no search");
  });

  it("offers an all / active / suspended status filter", () => {
    const body = code(src(CLIENT));
    assert.ok(body.includes('"all"') && body.includes('"active"') && body.includes('"suspended"'));
    assert.ok(body.includes("aria-pressed"), "filter must expose its selected state");
    assert.ok(body.includes('aria-label="filter by status"'), "filter must be labelled");
  });

  it("search hints at every matched field", () => {
    const body = code(src(CLIENT));
    const i = body.indexOf('aria-label="search students"');
    assert.ok(i >= 0);
    const block = body.slice(Math.max(0, i - 200), i + 600);
    for (const hint of ["USN", "username", "email"]) {
      assert.ok(block.toLowerCase().includes(hint.toLowerCase()), `placeholder must hint at ${hint}`);
    }
  });

  it("rows expose USN, email, username, spot, and status without a card redesign", () => {
    const body = code(src(CLIENT));
    assert.ok(body.includes("s.usn"), "row must show USN");
    assert.ok(body.includes("s.email"), "row must show the real verification_records email");
    assert.ok(body.includes("@${s.username}") || body.includes("@`${s.username}`") || body.includes("@"), "row must show username");
    assert.ok(body.includes("s.spot"), "row must show spot");
    assert.ok(body.includes("suspended") && body.includes("studentState(s)"), "row must show status");
  });

  it("keeps the existing student state, pagination, and moderation", () => {
    const body = code(src(CLIENT));
    for (const s of ["suspended", "verifying", "no profile", "photos pending", "complete"]) {
      assert.ok(body.includes(`"${s}"`), `studentState must keep "${s}"`);
    }
    assert.ok(body.includes("PAGE_SIZE") && body.includes("total > PAGE_SIZE"), "pagination preserved");
    assert.ok(body.includes("/api/inside/students/moderate"), "suspend/restore preserved");
  });

  it("route forwards a whitelisted status to the RPC under the admin gate", () => {
    const body = code(src(STUDENTS_ROUTE));
    assert.ok(body.includes("requireInsideAdmin()"), "must check the gate");
    assert.ok(body.includes("status: 403"), "must refuse with 403");
    assert.ok(body.includes("p_status"), "must forward the status filter");
    assert.ok(body.includes('"suspended"') && body.includes('"active"'), "must whitelist statuses");
    assert.ok(body.includes("admin_list_students"), "must reuse the listing RPC");
    assert.ok(!body.includes("auth.users"), "route must never read auth users");
    // The email column itself comes from verification_records (asserted on
    // the RPC, where the SELECT survives comment-stripping).
    const mig = code(src(MIG));
    assert.ok(mig.includes("v.email as email"), "RPC must select verification_records.email");
    assert.ok(mig.includes("from public.verification_records"), "email source stays verification_records");
  });
});

describe("inside dashboard — security posture unchanged", () => {
  it("page and students route stay server-gated (no client-only auth)", () => {
    assert.ok(code(src(PAGE)).includes("requireInsideAdmin()"), "page must keep the gate");
    assert.ok(code(src(STUDENTS_ROUTE)).includes("requireInsideAdmin()"), "route must keep the gate");
    assert.ok(!code(src(CLIENT)).includes("is_admin"), "client must not decide authorization");
  });

  it("no RLS change in the refinement migration", () => {
    const body = code(src(MIG));
    assert.ok(!/row level security|create\s+policy/i.test(body), "no RLS or policy change");
  });
});
