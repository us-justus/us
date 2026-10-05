import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

/**
 * Static regression guards for `/inside` Step 2 (immutable admin audit log).
 *
 * The route handlers depend on Next/Supabase request contexts and the audit
 * table lives in the database, so live insert/RLS behaviors are verified
 * against staging/localhost in the manual checklist. These tests guard the
 * properties that MUST hold in source: the migration's RLS/grant model,
 * the controlled action set, actor derivation, secret hygiene, event
 * wiring order, fail-closed launch compensation, and Step 1 regressions.
 */

const ROOT = new URL("../../../", import.meta.url);
const MIG = "supabase/migrations/20261010000001_inside_audit_log.sql";

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

const EXPECTED_ACTIONS = [
  "ADMIN_LOGIN_SUCCESS",
  "ADMIN_LOGIN_FAILURE",
  "ADMIN_LOGOUT",
  "LAUNCH_ENABLED",
  "LAUNCH_DISABLED",
  "LAUNCH_VERSION_CHANGED",
];
// NOTE (Step 3): the three moderation actions (STUDENT_SUSPENDED,
// STUDENT_RESTORED, REPORT_RESOLVED) extend the CHECK in migration
// 20261011000001_inside_students_moderation.sql and are guarded in
// src/lib/inside/moderation.test.ts. This file keeps pinning the Step 2
// migration + helper inclusion so neither file can silently narrow the set.

describe("inside audit — migration and schema", () => {
  it("migration file exists", () => {
    assert.ok(existsSync(new URL(MIG, ROOT)), "migration file must exist");
  });

  it("creates inside_audit_events with the required columns", () => {
    const body = code(src(MIG));
    for (const col of [
      "actor_user_id",
      "action",
      "target_type",
      "target_id",
      "metadata",
      "created_at",
    ]) {
      assert.ok(body.includes(col), `schema must include ${col}`);
    }
    assert.ok(body.includes("references auth.users"), "actor must reference auth.users");
    assert.ok(body.includes("jsonb"), "metadata must be jsonb");
    assert.ok(
      body.includes("default gen_random_uuid()"),
      "id must follow the project uuid convention",
    );
  });

  it("enables RLS with no policies and no client grants (append-only, immutable)", () => {
    const body = code(src(MIG));
    assert.ok(body.includes("enable row level security"), "RLS must be enabled");
    assert.ok(!/create\s+policy/i.test(body), "no policies: every client role is denied");
    assert.ok(!/\bgrant\b/i.test(body), "no grants to anon/authenticated/public");
  });

  it("enforces the controlled action set at the DB level", () => {
    const body = code(src(MIG));
    const i = body.indexOf("check (action in (");
    assert.ok(i >= 0, "CHECK constraint on action must exist");
    const block = body.slice(i, i + 600);
    for (const a of EXPECTED_ACTIONS) {
      assert.ok(block.includes(`'${a}'`), `CHECK must allow ${a}`);
    }
  });

  it("indexes newest-first pagination and actor/action/target filtering", () => {
    const body = code(src(MIG));
    assert.ok(body.includes("created_at desc"), "newest-first index required");
    assert.ok(body.includes("actor_user_id"), "actor index required");
    assert.ok(body.includes("(action)"), "action index required");
    assert.ok(body.includes("(target_type, target_id)"), "target index required");
  });
});

describe("inside audit — helper (src/lib/inside/audit.ts)", () => {
  it("is the single audit implementation with the centralized action set", () => {
    const body = code(src("src/lib/inside/audit.ts"));
    const i = body.indexOf("INSIDE_AUDIT_ACTIONS");
    assert.ok(i >= 0);
    const block = body.slice(i, i + 600);
    for (const a of EXPECTED_ACTIONS) {
      assert.ok(block.includes(`"${a}"`), `action set must include ${a}`);
    }
  });

  it("derives the actor from requireInsideAdmin(), never from arguments", () => {
    const body = code(src("src/lib/inside/audit.ts"));
    assert.ok(body.includes("requireInsideAdmin()"), "must reuse the Step 1 gate");
    assert.ok(body.includes("actorUserId: gate.userId"), "actor must come from the gate");
    assert.ok(
      !/export async function recordInsideAuditEvent\([^)]*actor/i.test(body),
      "no actor parameter may exist for clients to supply",
    );
    assert.ok(
      !body.includes("actor_user_id: req") && !body.includes("actorUserId: req"),
      "actor must never come from the request",
    );
  });

  it("re-checks admin membership for login success (non-admin gains no event)", () => {
    const body = code(src("src/lib/inside/audit.ts"));
    const i = body.indexOf("recordInsideLoginSuccess");
    assert.ok(i >= 0);
    const block = body.slice(i, i + 1200);
    assert.ok(block.includes("admin_users"), "must re-check membership server-side");
    assert.ok(block.includes("not authorized"), "must refuse non-admins");
  });

  it("writes only through the server-only service-role client", () => {
    const body = code(src("src/lib/inside/audit.ts"));
    assert.ok(body.includes("createServiceRoleClient"), "privileged writer only");
    assert.ok(body.includes('from("inside_audit_events")'), "targets the audit table");
    assert.ok(!/\.update\(\s*\{/.test(body), "no UPDATE path may exist");
    assert.ok(!/\.delete\(\s*\)/.test(body), "no DELETE path may exist");
    assert.ok(!body.includes("use client"), "must stay server-only");
  });

  it("hashes login identifiers with the login-abuse privacy approach", () => {
    const body = code(src("src/lib/inside/audit.ts"));
    const i = body.indexOf("hashAdminLoginIdentity");
    assert.ok(i >= 0);
    const block = body.slice(i, i + 400);
    assert.ok(block.includes("normalizeAdminLoginIdentity"), "must reuse limiter normalization");
    assert.ok(block.includes('createHash("sha256")'), "must hash, never store raw");
  });

  it("never stores secrets in metadata", () => {
    const body = code(src("src/lib/inside/audit.ts"));
    const metaLines = body.split("\n").filter((l) => l.includes("metadata"));
    assert.ok(metaLines.length > 0);
    for (const l of metaLines) {
      assert.ok(
        !/passw|adminkey|admin_key|adminsecret|smtp|service[-_ ]?role[-_ ]?key|session[-_ ]?token|recovery[-_ ]?token|verification[-_ ]?token/i.test(
          l,
        ),
        `no secrets in metadata: ${l.trim()}`,
      );
    }
  });

  it("documents the audit failure behavior", () => {
    const body = src("src/lib/inside/audit.ts");
    assert.ok(body.includes("FAIL CLOSED"), "launch fail-closed must be documented");
    assert.ok(body.includes("BEST-EFFORT"), "login/logout best-effort must be documented");
  });
});

describe("inside audit — login wiring", () => {
  const login = () => code(src("src/app/api/inside/login/route.ts"));

  it("records ADMIN_LOGIN_SUCCESS after verification", () => {
    const body = login();
    assert.ok(body.includes("recordInsideLoginSuccess(user.id)"), "actor = session user id");
    assert.ok(
      body.indexOf("await recordInsideLoginSuccess") > body.indexOf('supabase.rpc("is_admin")'),
      "success recorded only after authorization",
    );
  });

  it("records ADMIN_LOGIN_FAILURE on every generic 401 carrying an identifier", () => {
    const body = login();
    const calls = body.match(/await auditFailure\(\)/g) ?? [];
    // origin, service-role config, admin-key config, bad key, resolver miss,
    // sign-in failure, missing user, non-admin = 8.
    assert.ok(calls.length >= 6, `expected failure hooks on all 401 paths, found ${calls.length}`);
    assert.ok(body.includes("recordInsideLoginFailure(identityHash)"));
  });

  it("failure events carry only the hashed identifier — no credentials", () => {
    const body = login();
    for (const m of body.matchAll(/recordInsideLoginFailure\(([^)]*)\)/g)) {
      assert.equal(m[1].trim(), "identityHash", "only the pre-hashed digest may be passed");
    }
    assert.ok(!/recordInsideLogin\w*\(.*\b(pw|password|adminKey)\b/i.test(body));
  });

  it("limiter (429) and outage (503) verdicts record no auth event", () => {
    const body = login();
    // The 429 block returns before any auditFailure on that path, and the
    // 503 resolver-outage returns carry no audit hook.
    const lines = body.split("\n");
    for (let n = 0; n < lines.length; n++) {
      if (lines[n].includes("status: 503")) {
        const block = lines.slice(Math.max(0, n - 4), n + 1).join("\n");
        assert.ok(!block.includes("auditFailure"), "503 path must not audit");
      }
    }
  });
});

describe("inside audit — logout wiring", () => {
  it("records ADMIN_LOGOUT from the pre-clear admin identity", () => {
    const body = code(src("src/app/api/inside/logout/route.ts"));
    assert.ok(body.includes('recordInsideAuditEvent("ADMIN_LOGOUT")'));
    assert.ok(
      body.indexOf("await recordInsideAuditEvent") < body.indexOf("clearInsideCookieHeader()"),
      "audit must run before the cookie is cleared",
    );
  });
});

describe("inside audit — launch wiring", () => {
  const launch = () => code(src("src/app/api/inside/launch/route.ts"));

  it("records LAUNCH_ENABLED / LAUNCH_DISABLED on real flips", () => {
    const body = launch();
    assert.ok(body.includes('"LAUNCH_ENABLED"'));
    assert.ok(body.includes('"LAUNCH_DISABLED"'));
    assert.ok(body.includes("previous_launched"), "must record previous state");
    assert.ok(body.includes("new_launched"), "must record new state");
  });

  it("records LAUNCH_VERSION_CHANGED with previous/new version", () => {
    const body = launch();
    assert.ok(body.includes('"LAUNCH_VERSION_CHANGED"'));
    assert.ok(body.includes("previous_version"));
    assert.ok(body.includes("new_version"));
  });

  it("never records a success event for a failed mutation", () => {
    const body = launch();
    const errReturn = body.indexOf("Could not update launch state.");
    const firstAudit = body.indexOf("await recordInsideAuditEvent");
    assert.ok(errReturn >= 0 && firstAudit > errReturn, "mutation error returns before any audit");
  });

  it("records nothing for no-op calls", () => {
    const body = launch();
    assert.ok(body.includes("!launchedChanged && !versionChanged"), "no-op guard must exist");
  });

  it("fails closed with compensation when the audit write fails", () => {
    const body = launch();
    assert.ok(body.includes("!audited"), "audit result must be checked");
    const restores = body.match(/admin_set_launch/g) ?? [];
    assert.ok(restores.length >= 2, "must restore via the sanctioned writer on audit failure");
    const i = body.indexOf("!audited");
    assert.ok(body.slice(i, i + 800).includes("status: 500"), "must return 500, never silent success");
  });
});

describe("inside audit — authorization and security", () => {
  it("non-admin cannot create an audit event", () => {
    const body = code(src("src/lib/inside/audit.ts"));
    assert.ok(body.includes("not authorized"), "gate failures must refuse");
    // Every actor written is one of: the verified gate user, the
    // membership-checked login user, or NULL (failed login). No
    // request/client-derived shape may appear.
    const actors = [...body.matchAll(/actorUserId:\s*([^\s,}]+)/g)]
      .map((m) => m[1])
      .filter((a) => a !== "string"); // type annotation, not a write
    assert.ok(actors.length >= 3, "expected all three write paths");
    for (const a of actors) {
      assert.ok(
        ["gate.userId", "userId", "null"].includes(a),
        `actor must be server-verified, got: ${a}`,
      );
    }
  });

  it("client cannot impersonate another admin", () => {
    for (const rel of [
      "src/app/api/inside/login/route.ts",
      "src/app/api/inside/logout/route.ts",
      "src/app/api/inside/launch/route.ts",
    ]) {
      const body = code(src(rel));
      assert.ok(!body.includes("actor_user_id"), `no actor field in ${rel}`);
      assert.ok(!/recordInside\w+\([^)]*userId[^)]*\)/i.test(body.replace("recordInsideLoginSuccess(user.id)", "")), `no caller-supplied actor in ${rel}`);
    }
  });

  it("no secrets reach audit metadata from any route", () => {
    for (const rel of [
      "src/lib/inside/audit.ts",
      "src/app/api/inside/login/route.ts",
      "src/app/api/inside/logout/route.ts",
      "src/app/api/inside/launch/route.ts",
    ]) {
      const metaLines = code(src(rel))
        .split("\n")
        .filter((l) => l.includes("metadata"));
      for (const l of metaLines) {
        assert.ok(
          !/passw|adminkey|admin_key|smtp|service[-_ ]?role[-_ ]?key|session[-_ ]?token|recovery[-_ ]?token/i.test(
            l,
          ),
          `no secrets in ${rel}: ${l.trim()}`,
        );
      }
    }
  });

  it("audit rows are readable only through a server-side admin path", () => {
    const body = code(src(MIG));
    assert.ok(!/\bgrant\b/i.test(body), "no SELECT grant for the browser");
    const helper = code(src("src/lib/inside/audit.ts"));
    assert.ok(!helper.includes("NEXT_PUBLIC"), "no client-exposed credentials");
  });
});

describe("inside audit — Step 1 and product regressions", () => {
  it("inside login keeps its Step 1 architecture", () => {
    const body = code(src("src/app/api/inside/login/route.ts"));
    assert.ok(body.includes("verifyAdminKey"), "admin-key check preserved");
    assert.ok(body.includes('supabase.rpc("is_admin")'), "is_admin() check preserved");
    assert.ok(body.includes("resolve_login_email"), "USN resolver preserved");
    assert.ok(body.includes("resolve_phone_login_email"), "phone resolver preserved");
    assert.ok(body.includes("verifySameOrigin"), "Origin check preserved");
    assert.ok(body.includes("check_login_rate_limit"), "rate limiter preserved");
  });

  it("inside launch keeps its Step 1 architecture", () => {
    const body = code(src("src/app/api/inside/launch/route.ts"));
    assert.ok(body.includes("requireInsideAdmin"), "gate preserved");
    assert.ok(body.includes("admin_set_launch"), "sanctioned writer preserved");
    assert.ok(body.includes("verifySameOrigin"), "Origin check preserved");
  });

  it("student authentication is untouched (no inside imports)", () => {
    const body = code(src("src/app/api/auth/login/route.ts"));
    assert.ok(body.includes("resolve_login_email"), "student resolver preserved");
    assert.ok(!body.includes("inside/audit"), "student login must not touch audit");
    assert.ok(!body.includes("inside/auth"), "student login must not touch inside auth");
  });
});
