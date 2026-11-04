import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Static regression guards for `/inside` Step 2 (immutable admin audit log).
 *
 * The route handlers depend on Next/Supabase request contexts and the audit
 * table lives in the database, so live insert/RLS behaviors are verified
 * against staging/localhost in the manual checklist. These tests guard the
 * properties that MUST hold in source: the migration's RLS/grant model,
 * the controlled action set, actor derivation, secret hygiene,event
 * wiring order, fail-closed moderation compensation, and Step 1 regressions.
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
    assert.ok(body.includes("FAIL CLOSED"), "moderation fail-closed must be documented");
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
    // origin, service-role config, server key config, resolver miss,
    // sign-in failure, missing user, non-admin = 7.
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

describe("inside audit — launch removal (no launch actions, no launch route)", () => {
  it("helper carries no launch actions", () => {
    const body = code(src("src/lib/inside/audit.ts"));
    for (const a of ["LAUNCH_ENABLED", "LAUNCH_DISABLED", "LAUNCH_VERSION_CHANGED"]) {
      assert.ok(!body.includes(`"${a}"`), `action set must drop ${a}`);
      assert.ok(!body.includes(`'${a}'`), `action set must drop ${a}`);
    }
  });

  it("launch route is removed", () => {
    assert.ok(
      !existsSync(new URL("src/app/api/inside/launch/route.ts", ROOT)),
      "the launch route must be removed",
    );
  });

  it("no application runtime code references launch state", () => {
    // Source-level guard: no runtime module may reference the removed
    // launch table, writer, or helpers. Test files asserting the removal
    // and historical migration comments are excluded.
    const banned = [
      "launch_config",
      "admin_set_launch",
      "getLaunchState",
      "guardLaunch",
      "productPhaseFor",
      "isLaunchGatedPath",
      "prelaunch_version",
    ];
    const offenders: string[] = [];

    const walk = (dir: URL) => {
      const base = fileURLToPath(dir);

      for (const entry of readdirSync(base)) {
        const full = join(base, entry);
        const st = statSync(full);

        if (st.isDirectory()) {
          walk(pathToFileURL(full));
        } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) {
          const body = readFileSync(full, "utf8");
          for (const b of banned) {
            if (body.includes(b)) {
              offenders.push(`${full.split(/[\\/]+us[\\/]+/)[1] ?? full}: ${b}`);
              break;
            }
          }
        }
      }
    };

    walk(new URL("../../../src/", import.meta.url));
    assert.deepEqual(offenders, [], "runtime code must not reference launch state");
  });

  it("no application runtime code references the launch writer or launch table", () => {
    const MIG = src("supabase/migrations/20261012000001_remove_launch_system.sql");
    assert.ok(MIG.includes("drop function if exists public.admin_set_launch(boolean, text)"));
    assert.ok(MIG.includes("drop table if exists public.launch_config"));
  });

  it("cleanup migration keeps the active audit CHECK strict (six permanent actions)", () => {
    const body = code(src("supabase/migrations/20261012000001_remove_launch_system.sql"));
    // Scope to the ACTIVE table CHECK (PART 5): the same file legitimately
    // names the three launch actions in its archive-table CHECK + backfill.
    const i = body.indexOf("add constraint inside_audit_events_action_check");
    assert.ok(i >= 0, "cleanup must rewrite the active CHECK constraint");
    const block = body.slice(i, i + 600);
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
    for (const a of ["LAUNCH_ENABLED", "LAUNCH_DISABLED", "LAUNCH_VERSION_CHANGED"]) {
      assert.ok(!block.includes(`'${a}'`), `active CHECK must drop ${a}`);
    }
  });

  it("cleanup migration archives historical launch events (no history loss)", () => {
    const body = code(src("supabase/migrations/20261012000001_remove_launch_system.sql"));
    assert.ok(
      body.includes("create table if not exists public.inside_audit_events_history"),
      "must create the launch-event archive table idempotently",
    );
    // The archive mirrors every useful audit column — never just the action.
    for (const col of [
      "actor_user_id",
      "action",
      "target_type",
      "target_id",
      "metadata",
      "created_at",
    ]) {
      const createAt = body.indexOf("inside_audit_events_history (");
      assert.ok(createAt >= 0);
      const def = body.slice(createAt, createAt + 1200);
      assert.ok(def.includes(col), `archive schema must include ${col}`);
    }
    // Archive admits ONLY the three launch actions: history stays
    // identifiable and the archive can never become a second live table.
    const h = body.indexOf("constraint inside_audit_events_history_action_check");
    assert.ok(h >= 0, "archive must carry a launch-only CHECK constraint");
    const hBlock = body.slice(h, h + 400);
    for (const a of ["LAUNCH_ENABLED", "LAUNCH_DISABLED", "LAUNCH_VERSION_CHANGED"]) {
      assert.ok(hBlock.includes(`'${a}'`), `archive CHECK must admit ${a}`);
    }
    for (const a of [
      "ADMIN_LOGIN_SUCCESS",
      "ADMIN_LOGIN_FAILURE",
      "ADMIN_LOGOUT",
      "STUDENT_SUSPENDED",
      "STUDENT_RESTORED",
      "REPORT_RESOLVED",
    ]) {
      assert.ok(!hBlock.includes(`'${a}'`), `archive CHECK must not admit ${a}`);
    }
    // Backfill copies launch rows idempotently, then removes them from the
    // active table so the strict CHECK can be added; permanent events are
    // never touched and no launch row is renamed into another action.
    assert.ok(body.includes("not exists"), "backfill must skip already-archived rows");
    assert.ok(
      body.includes("delete from public.inside_audit_events"),
      "must clear launch rows from the active table",
    );
    const delAt = body.indexOf("delete from public.inside_audit_events");
    const delBlock = body.slice(delAt, delAt + 400);
    for (const a of ["LAUNCH_ENABLED", "LAUNCH_DISABLED", "LAUNCH_VERSION_CHANGED"]) {
      assert.ok(delBlock.includes(`'${a}'`), `active-table delete must target ${a}`);
    }
    // Archive RLS mirrors the active table: enabled, no policies, no grants.
    const rlsAt = body.indexOf("inside_audit_events_history enable row level security");
    assert.ok(rlsAt >= 0, "archive RLS must be enabled");
    assert.ok(!/create\s+policy/i.test(body), "no policies: archive has no client access");
    assert.ok(!/\bgrant\b/i.test(body), "no grants on the archive table");
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
    ]) {
      const body = code(src(rel));
      assert.ok(!body.includes("actor_user_id"), `no actor field in ${rel}`);
      assert.ok(
        !/recordInside\w+\([^)]*userId[^)]*\)/i.test(
          body.replace("recordInsideLoginSuccess(user.id)", ""),
        ),
        `no caller-supplied actor in ${rel}`,
      );
    }
  });

  it("no secrets reach audit metadata from any route", () => {
    for (const rel of [
      "src/lib/inside/audit.ts",
      "src/app/api/inside/login/route.ts",
      "src/app/api/inside/logout/route.ts",
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
    assert.ok(!body.includes("adminKey"), "no browser-supplied key may be required");
    assert.ok(body.includes("isInsideConfigured"), "server-side key config guard preserved");
    assert.ok(body.includes("mintInsideSession"), "server-signed session preserved");
    assert.ok(body.includes('supabase.rpc("is_admin")'), "is_admin() check preserved");
    assert.ok(body.includes("resolve_login_email"), "USN resolver preserved");
    assert.ok(body.includes("resolve_phone_login_email"), "phone resolver preserved");
    assert.ok(body.includes("verifySameOrigin"), "Origin check preserved");
    assert.ok(body.includes("check_login_rate_limit"), "rate limiter preserved");
  });

  it("inside launch surface is removed (no route, no writer, no helpers)", () => {
    assert.ok(
      !existsSync(new URL("src/app/api/inside/launch/route.ts", ROOT)),
      "launch route must be removed",
    );
    assert.ok(
      !existsSync(new URL("src/lib/auth/launch.ts", ROOT)),
      "launch helpers must be removed",
    );
  });

  it("student authentication is untouched (no inside imports)", () => {
    const body = code(src("src/app/api/auth/login/route.ts"));
    assert.ok(body.includes("resolve_login_email"), "student resolver preserved");
    assert.ok(!body.includes("inside/audit"), "student login must not touch audit");
    assert.ok(!body.includes("inside/auth"), "student login must not touch inside auth");
  });
});