import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolveAppVersion, resolveEnvironment } from "./health.ts";

/**
 * Static + live regression guards for `/inside` Step 4 (System Health).
 *
 * The route handler depends on Next/Supabase request contexts, so live
 * admin/anon/student behaviors are verified against staging in the manual
 * checklist. These tests guard the properties that MUST hold in source:
 * the route reuses requireInsideAdmin() with a generic 403, the response
 * carries status literals + display-only environment/version only (no
 * secrets, keys, credentials, or connection details), each dependency
 * degrades to "error" without throwing, realtime reports "not_checked"
 * instead of a false signal, the environment is display-only, and no
 * existing admin functionality or migration state changed.
 */

const ROOT = new URL("../../../", import.meta.url);
const ROUTE = "src/app/api/inside/health/route.ts";
const HELPER = "src/lib/inside/health.ts";
const CLIENT = "src/app/inside/inside-client.tsx";

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

describe("inside step 4 — route authorization (anon/student cannot)", () => {
  it("route file exists (no public /health endpoint)", () => {
    assert.ok(existsSync(new URL(ROUTE, ROOT)), "admin health route must exist");
    assert.ok(
      !existsSync(new URL("src/app/api/health/route.ts", ROOT)),
      "no public /health endpoint may exist",
    );
  });

  it("reuses requireInsideAdmin() and refuses with the generic 403", () => {
    const body = code(src(ROUTE));
    assert.ok(body.includes("requireInsideAdmin()"), "must check the gate");
    assert.ok(body.includes("if (!gate)"), "failing gate must refuse");
    assert.ok(body.includes("status: 403"), "must refuse with 403");
    assert.ok(body.includes("GENERIC"), "refusal must use the generic body");
  });

  it("performs the gate before any dependency check", () => {
    const body = code(src(ROUTE));
    const gateAt = body.indexOf("requireInsideAdmin()");
    assert.ok(gateAt >= 0);
    for (const marker of [".from(", ".auth.getUser(", ".storage"]) {
      const at = body.indexOf(marker);
      if (at >= 0) assert.ok(at > gateAt, `${marker} must run after the gate`);
    }
  });

  it("accepts no actor or user id from the browser", () => {
    const body = code(src(ROUTE));
    assert.ok(!body.includes("actor_user_id"), "no actor field");
    assert.ok(!/request\.json|searchParams|formData/i.test(body), "GET takes no input");
  });
});

describe("inside step 4 — response shape", () => {
  it("returns exactly the six contracted fields", () => {
    const body = code(src(ROUTE));
    for (const k of ["database", "auth", "storage", "realtime", "environment", "version"]) {
      assert.ok(body.includes(k), `response must include ${k}`);
    }
  });

  it("status fields use ok/error/not_checked literals only", () => {
    const body = code(src(ROUTE));
    assert.ok(body.includes('"ok"') || body.includes("'ok'") || body.includes('= "ok"'));
    assert.ok(body.includes('"error"'));
    assert.ok(body.includes('"not_checked"'));
  });

  it("realtime reports not_checked (no false health signal)", () => {
    const body = code(src(ROUTE));
    assert.ok(body.includes("not_checked"), "realtime must be not_checked");
    // No websocket/channel probe is created to fake a live signal.
    assert.ok(!/createChannel|\.channel\(|\.subscribe\(/.test(body), "no realtime probe");
  });
});

describe("inside step 4 — secret/config redaction", () => {
  it("route never touches service-role material", () => {
    const body = code(src(ROUTE));
    assert.ok(!body.includes("createServiceRoleClient"), "no service-role client");
    assert.ok(!body.includes("SUPABASE_SERVICE_ROLE_KEY"), "no service-role key");
    assert.ok(!body.includes("ADMIN_SECRET_KEY"), "no admin key");
  });

  it("route returns no credentials, connection details, or private fields", () => {
    const body = code(src(ROUTE));
    assert.ok(
      !/anon_key|anonkey|service_role|connection string|postgres:\/\/|database_url/i.test(body),
      "no credentials or connection details",
    );
    assert.ok(!/\busn\b|\bemail\b|password|token/i.test(body), "no private fields");
  });

  it("route logs nothing secret-bearing", () => {
    const logs = code(src(ROUTE))
      .split("\n")
      .filter((l) => l.includes("console."));
    for (const l of logs) {
      assert.ok(!l.includes("${"), `no interpolations in logs: ${l.trim()}`);
    }
  });

  it("helper exposes version/environment only (no secrets)", () => {
    const body = code(src(HELPER));
    assert.ok(!/SECRET|TOKEN|KEY=|password/i.test(body), "helper must carry no secrets");
  });
});

describe("inside step 4 — environment reporting (live)", () => {
  it("distinguishes local, staging, and production", async (t) => {
    const saved = {
      APP_ENV: process.env.APP_ENV,
      NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
      URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    };
    t.after(() => {
      for (const [k, v] of Object.entries({
        APP_ENV: saved.APP_ENV,
        NEXT_PUBLIC_APP_ENV: saved.NEXT_PUBLIC_APP_ENV,
        VERCEL_ENV: saved.VERCEL_ENV,
        NEXT_PUBLIC_SUPABASE_URL: saved.URL,
      })) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
    delete process.env.APP_ENV;
    delete process.env.NEXT_PUBLIC_APP_ENV;
    delete process.env.VERCEL_ENV;

    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    assert.equal(resolveEnvironment(), "local");

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ietruyukgqwkmsyfvxxi.supabase.co";
    assert.equal(resolveEnvironment(), "staging");

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://drhticapxbhpqosrkngy.supabase.co";
    assert.equal(resolveEnvironment(), "production");
  });

  it("prefers an explicit APP_ENV over URL inference", async (t) => {
    const savedEnv = process.env.APP_ENV;
    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    t.after(() => {
      if (savedEnv === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = savedEnv;
      if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    });
    delete process.env.NEXT_PUBLIC_APP_ENV;
    delete process.env.VERCEL_ENV;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ietruyukgqwkmsyfvxxi.supabase.co";
    process.env.APP_ENV = "production";
    assert.equal(resolveEnvironment(), "production");
  });

  it("environment is display-only (never gates authorization)", () => {
    const body = code(src(ROUTE));
    const gateAt = body.indexOf("requireInsideAdmin()");
    const envAt = body.indexOf("resolveEnvironment()");
    assert.ok(gateAt >= 0 && envAt > gateAt, "env resolves after the gate");
    assert.ok(!/if\s*\([^)]*environment/i.test(body), "env must not branch auth");
    assert.ok(!/if\s*\([^)]*resolveEnvironment/i.test(body), "env must not branch auth");
  });

  it("version falls back to a safe static identifier", async (t) => {
    const saved = process.env.NEXT_PUBLIC_APP_VERSION;
    t.after(() => {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_APP_VERSION;
      else process.env.NEXT_PUBLIC_APP_VERSION = saved;
    });
    delete process.env.NEXT_PUBLIC_APP_VERSION;
    assert.equal(resolveAppVersion(), "0.1.0");
    process.env.NEXT_PUBLIC_APP_VERSION = "  ";
    assert.equal(resolveAppVersion(), "0.1.0");
  });
});

describe("inside step 4 — unhealthy dependency handling", () => {
  it("every check is isolated in try/catch and degrades to error", () => {
    const body = code(src(ROUTE));
    const catches = body.match(/catch\s*\{/g) ?? [];
    assert.ok(catches.length >= 2, `each remaining dependency check needs isolation, found ${catches.length}`);
    const errors = body.match(/=\s*"error"/g) ?? [];
    assert.ok(errors.length >= 2, "each remaining dependency check must degrade to error");
  });

  it("database check is a lightweight probe (no writes, no user enumeration, no launch state)", () => {
    const body = code(src(ROUTE));
    assert.ok(body.includes('supabase.rpc("is_admin")'), "reuses a boolean-only RPC probe");
    assert.ok(!body.includes("launch_config"), "must not depend on the removed launch table");
    assert.ok(!body.includes(".insert("), "no writes");
    assert.ok(!body.includes(".update("), "no writes");
    assert.ok(!body.includes(".delete("), "no writes");
    assert.ok(!/auth\.admin/i.test(body), "no admin user enumeration");
  });

  it("reuses the gate's caller session check", () => {
    const body = code(src(ROUTE));
    assert.ok(body.includes("requireInsideAdmin()"), "the gate owns the session lookup");
    assert.ok(body.includes('const auth: Status = "ok"'), "reuses the gate's successful session check");
    assert.ok(!/listUsers|getUserById/i.test(body), "no user enumeration");
  });

  it("storage check lists the existing bucket (no uploads)", () => {
    const body = code(src(ROUTE));
    assert.ok(body.includes('from("profile-photos")'), "reuses the existing bucket");
    assert.ok(body.includes(".list("), "lightweight list probe");
    assert.ok(!body.includes(".upload("), "no uploads");
    assert.ok(!body.includes(".remove("), "no deletes");
  });
});

describe("inside step 4 — dashboard UI", () => {
  it("renders a compact system health panel with a refresh control", () => {
    const body = code(src(CLIENT));
    assert.ok(body.includes("HealthPanel"), "dashboard must include the panel");
    assert.ok(body.includes('aria-label="system health"'), "panel must be labelled");
    assert.ok(body.includes("/api/inside/health"), "panel must call the admin route");
    assert.ok(body.includes("refresh"), "panel must offer refresh");
  });

  it("shows operational / down / not-checked states explicitly", () => {
    const body = code(src(CLIENT));
    assert.ok(body.includes("Operational"), "healthy state must be explicit");
    assert.ok(body.includes("Not checked"), "not_checked must be explicit");
  });

  it("keeps students/reports panels mounted with no launch control", () => {
    const body = code(src(CLIENT));
    assert.ok(body.includes("StudentsPanel"), "students panel must stay");
    assert.ok(body.includes("ReportsPanel"), "reports panel must stay");
    assert.ok(body.includes("<ReportsPanel />"), "reports must render unconditionally");
    assert.ok(!body.includes("/api/inside/launch"), "launch control must be gone");
    assert.ok(!body.includes("launched"), "no launch state in the dashboard");
  });
});

describe("inside step 4 — no changes to existing admin functionality", () => {
  it("requires no migration (no health migration file)", () => {
    const dir = new URL("supabase/migrations/", ROOT);
    const files = readdirSync(dir).map(String);
    assert.ok(
      !files.some((f) => /health/i.test(f)),
      "no migration must be added for this step",
    );
  });

  it("existing admin routes still reuse the gate (students/reports/health)", () => {
    for (const rel of [
      "src/app/api/inside/students/route.ts",
      "src/app/api/inside/reports/route.ts",
      "src/app/api/inside/health/route.ts",
    ]) {
      const body = code(src(rel));
      assert.ok(body.includes("requireInsideAdmin()"), `${rel} must keep the gate`);
      assert.ok(body.includes("status: 403"), `${rel} must keep refusing with 403`);
    }
  });

  it("no launch API remains", () => {
    assert.ok(
      !existsSync(new URL("src/app/api/inside/launch/route.ts", ROOT)),
      "the launch route must be removed",
    );
  });

  it("audit action set carries no launch actions", () => {
    const body = code(src("src/lib/inside/audit.ts"));
    for (const a of ["STUDENT_SUSPENDED", "REPORT_RESOLVED"]) {
      assert.ok(body.includes(`"${a}"`), `audit must keep ${a}`);
    }
    for (const a of ["LAUNCH_ENABLED", "LAUNCH_DISABLED", "LAUNCH_VERSION_CHANGED"]) {
      assert.ok(!body.includes(`"${a}"`), `audit must drop ${a}`);
    }
  });
});
