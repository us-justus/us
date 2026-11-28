import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

/**
 * Static regression guards for `/inside` Step 1 hardening.
 *
 * The route handlers depend on Next/Supabase request contexts, so the
 * DB-backed behaviors (throttle enforcement, live is_admin() checks) are
 * verified against staging/localhost in the manual checklist. These tests
 * guard the properties that MUST hold in source: Origin wiring, failure
 * indistinguishability, secret hygiene, and RPC least-privilege.
 */

const ROOT = new URL("../../../", import.meta.url);

function src(rel: string): string {
  return readFileSync(new URL(rel, ROOT), "utf8");
}

describe("inside hardening — route wiring", () => {
  const login = src("src/app/api/inside/login/route.ts");
  const logout = src("src/app/api/inside/logout/route.ts");

  it("all state-changing inside APIs enforce the Origin check", () => {
    for (const [name, body] of [["login", login], ["logout", logout]] as const) {
      assert.ok(body.includes("verifySameOrigin"), `${name} must call verifySameOrigin`);
    }
  });

  it("logout rejects foreign origins before touching the cookie", () => {
    const body = logout.slice(logout.indexOf("export async function POST"));
    assert.ok(
      body.indexOf("verifySameOrigin") < body.indexOf("clearInsideCookieHeader()"),
      "origin check must precede cookie clearing",
    );
  });

  it("does not clear the admin cookie when revocation fails", () => {
    const body = logout.slice(logout.indexOf("export async function POST"));
    assert.ok(body.includes('service.rpc("revoke_inside_session"'));
    assert.ok(body.includes('status: 503'));
    assert.ok(body.includes('Could not end the admin session.'));
    assert.ok(body.includes('recordInsideLogout(gate.userId)'));
    assert.ok(body.indexOf('requireInsideAdmin()') < body.indexOf('revoke_inside_session'));
    assert.ok(body.indexOf('revoke_inside_session') < body.indexOf('recordInsideLogout(gate.userId)'));
    assert.ok(body.indexOf('status: 503') < body.indexOf('clearInsideCookieHeader()'));
  });

  it("login rate-limits before credential verification", () => {
    const body = login.slice(login.indexOf("export async function POST"));
    assert.ok(
      body.indexOf("check_login_rate_limit") < body.indexOf("signInWithPassword"),
      "throttle must bound credential-guessing cost",
    );
  });

  it("admin credential verification never persists into browser cookies", () => {
    assert.ok(login.includes("createSupabaseClient"));
    assert.ok(login.includes("persistSession: false"));
    assert.ok(!login.includes('@/lib/supabase/server'));
  });

  it("login resets the targeted bucket after a verified login", () => {
    assert.ok(login.includes("clear_login_rate_limit"));
  });

  it("login reuses the product limiter (no second implementation)", () => {
    assert.ok(login.includes("adminLoginRateLimitKeys"));
    assert.ok(login.includes("LOGIN_THROTTLED_MESSAGE"));
    assert.ok(!login.includes("new Map("), "process-local Maps are banned");
  });
});

describe("inside hardening — failure indistinguishability", () => {
  const login = src("src/app/api/inside/login/route.ts");

  it("every generic auth failure is the same 401 body", () => {
    const lines = login.split("\n");
    const generic = lines.filter((l) => l.includes("{ error: GENERIC }"));
    assert.ok(generic.length >= 5, "expected all failure paths to share GENERIC");
    for (const l of generic) {
      assert.ok(l.includes("status: 401"), `must be 401: ${l.trim()}`);
    }
  });

  it("only 401/429/503 statuses exist; 503 is the availability signal only", () => {
    const statuses = [...login.matchAll(/status:\s*(\d+)/g)].map((m) => m[1]);
    assert.ok(statuses.length > 0);
    for (const s of statuses) {
      assert.ok(["401", "429", "503"].includes(s), `unexpected status ${s}`);
    }
    const lines = login.split("\n");
    for (const l of lines.filter((l) => l.includes("status: 503"))) {
      assert.ok(
        l.includes("unavailable right now"),
        `503 must stay the DB-availability signal: ${l.trim()}`,
      );
    }
  });

  it("missing admin configuration returns the generic 401 (no config oracle)", () => {
    const lines = login.split("\n");
    const at = lines.findIndex((l) => l.includes("if (!isInsideConfigured())"));
    assert.ok(at >= 0, "config guard must exist");
    const block = lines.slice(at, at + 6).join("\n");
    assert.ok(block.includes("GENERIC"), "config failure must use the generic body");
    assert.ok(block.includes("status: 401"), "config failure must be 401");
    assert.ok(!block.includes("status: 503"), "config failure must not be a distinct 503");
  });

  it("missing service-role configuration returns the generic 401", () => {
    const i = login.indexOf("service = createServiceRoleClient()");
    assert.ok(i >= 0);
    const block = login.slice(i, i + 500);
    assert.ok(block.includes("GENERIC") && block.includes("status: 401"));
  });
});

describe("inside hardening — secret hygiene", () => {
  const login = src("src/app/api/inside/login/route.ts");

  it("server logs carry no secrets or identifiers", () => {
    const logs = login.split("\n").filter((l) => l.includes("console."));
    assert.ok(logs.length > 0, "expected server-side-only diagnostics");
    for (const l of logs) {
      assert.ok(!l.includes("${"), `no interpolations in logs: ${l.trim()}`);
      assert.ok(!l.toLowerCase().includes("adminkey"), `no key material: ${l.trim()}`);
    }
  });
});

describe("inside hardening — RPC least privilege", () => {
  it("ships a migration revoking authenticated from both resolvers", () => {
    const mig = "supabase/migrations/20261009000001_inside_admin_rpc_least_privilege.sql";
    assert.ok(existsSync(new URL(mig, ROOT)), "migration file must exist");
    const body = src(mig);
    assert.ok(body.includes("resolve_login_email(text, text)") && body.includes("from authenticated"));
    assert.ok(body.includes("resolve_phone_login_email(text, text)"));
    const grantsAuthenticated = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("--"))
      .filter((l) => /grant execute/i.test(l) && /authenticated/.test(l));
    assert.equal(grantsAuthenticated.length, 0, "no authenticated EXECUTE grants may remain");
  });

  it("preserves the session-client gate (is_admin stays callable, still re-checked)", () => {
    const auth = src("src/lib/inside/auth.ts");
    assert.ok(auth.includes('supabase.rpc("is_admin")'));
    assert.ok(auth.includes("export { INSIDE_COOKIE"));
  });
});
