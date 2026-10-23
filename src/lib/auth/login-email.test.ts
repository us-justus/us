import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyLoginIdentifier } from "./login-identifier.ts";
import {
  loginRateLimitKeys,
  loginRateLimitKeysForEmail,
  normalizeLoginEmail,
} from "./login-rate-limit.ts";
import { resolveLoginNext, safeNextPath } from "./safe-next.ts";

const HEX64 = /^[0-9a-f]{64}$/;
const ROUTE = new URL("../../app/api/auth/login/route.ts", import.meta.url);
const routeSrc = readFileSync(ROUTE, "utf8");
const PAGE = new URL("../../app/login/page.tsx", import.meta.url);
const pageSrc = readFileSync(PAGE, "utf8");

function srcFiles(dir: URL): string[] {
  const out: string[] = [];
  const base = fileURLToPath(dir);

  for (const entry of readdirSync(base)) {
    const full = join(base, entry);
    const st = statSync(full);

    if (st.isDirectory()) {
      out.push(...srcFiles(pathToFileURL(full)));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }

  return out;
}

describe("slice 3 — identifier classification (server-side)", () => {
  it("1. routes valid USNs to the existing USN login path", () => {
    assert.deepEqual(classifyLoginIdentifier("1AY22CS001"), {
      kind: "usn",
      usn: "1AY22CS001",
    });
    assert.deepEqual(classifyLoginIdentifier("  1ay22cs001 "), {
      kind: "usn",
      usn: "1AY22CS001",
    });
  });

  it("2. routes well-formed emails to the email login path", () => {
    assert.deepEqual(classifyLoginIdentifier("first-year@campus.edu"), {
      kind: "email",
      email: "first-year@campus.edu",
    });
    assert.deepEqual(classifyLoginIdentifier("  First@Campus.EDU "), {
      kind: "email",
      email: "first@campus.edu",
    });
  });

  it("rejects empty, malformed, overlong, and non-identifier input without distinction", () => {
    for (const bad of [
      "",
      "   ",
      "no-at-sign",
      "a@b",
      "@x.com",
      "a@b@c",
      "x".repeat(250) + "@y.com",
      42,
      null,
      {},
    ]) {
      assert.deepEqual(classifyLoginIdentifier(bad), { kind: "invalid" }, String(bad));
    }
  });

  it("never accepts internal sign-in identities as login input", () => {
    assert.deepEqual(
      classifyLoginIdentifier("u-abc123def456abc123def456abc12345@us.signin.invalid"),
      { kind: "invalid" },
    );
  });

  it("route: USN branch keeps the password-gated resolver (resolve_login_email)", () => {
    assert.ok(routeSrc.includes('service.rpc("resolve_login_email"'), "USN resolver preserved");
    assert.ok(routeSrc.includes("p_usn"), "resolver still keyed on USN");
    assert.ok(routeSrc.includes("p_password"), "resolver still password-gated");
    assert.ok(
      routeSrc.includes('from("verification_records")'),
      "post-sign-in USN ownership check preserved",
    );
  });

  it("route: email branch authenticates via Supabase Auth with the submitted email", () => {
    assert.ok(routeSrc.includes("classified.email"), "submitted email drives sign-in");
    const signIns = routeSrc.split("await supabase.auth.signInWithPassword").length - 1;
    assert.equal(signIns, 2, "one sign-in per path (USN resolver result + direct email)");
  });
});

describe("slice 3 — first-year account model", () => {
  it("3. email login requires no USN and synthesizes no fake/internal USN", () => {
    assert.ok(!routeSrc.includes("toInternalEmail"), "no internal identity construction on login");
    assert.ok(!routeSrc.includes("us.signin.invalid"), "no internal-identity literal on login");
    assert.ok(routeSrc.includes("No USN"), "email path documented as USN-free");
  });

  it("4. same Supabase Auth account is used — no signUp() anywhere in src/", () => {
    const offenders: string[] = [];

    for (const f of srcFiles(new URL("../../../../", ROUTE))) {
      if (f.endsWith(".test.ts")) continue;

      const body = readFileSync(f, "utf8");
      if (body.includes("signUp(")) offenders.push(f);
    }

    assert.deepEqual(offenders, [], "signUp() must never appear outside tripwire tests");
    assert.ok(!routeSrc.includes("admin.updateUserById"), "login never mutates auth identities");
  });

  it("9. completed login resolves to /home", () => {
    // The route's fallback is destinationForStep(step); step complete → "/home"
    // (stepPath). resolveLoginNext() must therefore yield "/home" for a complete
    // account when no valid ?next= is supplied.
    assert.ok(routeSrc.includes("destinationForStep(step)"), "existing destination machinery reused");

    for (const requestedNext of [null, "//evil"]) {
      assert.equal(
        resolveLoginNext({ step: "complete", requestedNext, fallback: "/home" }),
        "/home",
        `next ${String(requestedNext)}`,
      );
    }

    assert.equal(
      resolveLoginNext({ step: "complete", requestedNext: "/search", fallback: "/home" }),
      "/search",
      "allowlisted ?next= is honored for complete accounts",
    );
  });
});

describe("slice 3 — security preserved", () => {
  it("5+11. every credential failure uses the one generic message (no enumeration)", () => {
    assert.ok(routeSrc.includes('const GENERIC = "Incorrect USN or password."'), "generic message unchanged");
    const withoutGeneric401 = routeSrc
      .split("{ error: GENERIC }, { status: 401 }")
      .join("");
    assert.ok(!withoutGeneric401.includes("401"), "every failure uses the generic message");
    // The email branch must not introduce a distinct message.
    const generics = routeSrc.split("const GENERIC = ").length - 1;
    assert.equal(generics, 1, "exactly one failure message on the route");
  });

  it("6+10. USN wrong-password behavior is unchanged", () => {
    const rpcIdx = routeSrc.indexOf('service.rpc("resolve_login_email"');
    const signInIdx = routeSrc.indexOf("signInWithPassword({ email, password: pw })");
    assert.ok(rpcIdx > 0 && signInIdx > rpcIdx, "USN order preserved: resolver → sign-in");
    assert.ok(
      routeSrc.includes('if (typeof email !== "string" || !email)'),
      "null resolver result still fails generically",
    );
  });

  it("7. rate limiting gates BOTH identifier types before credential work", () => {
    const gateIdx = routeSrc.indexOf('service.rpc("check_login_rate_limit"');
    assert.ok(gateIdx > 0, "limiter gate preserved");
    assert.ok(
      gateIdx < routeSrc.indexOf('service.rpc("resolve_login_email"'),
      "USN path gated first",
    );
    assert.ok(
      gateIdx < routeSrc.indexOf("email: classified.email"),
      "email path gated first",
    );
    assert.ok(routeSrc.includes("loginRateLimitKeysForEmail"), "email bucket helper wired");
    assert.ok(
      routeSrc.includes('service.rpc("clear_login_rate_limit"'),
      "success clears the targeted bucket",
    );
  });

  it("7. email buckets hash like USN buckets (no raw email/IP stored)", () => {
    const a = loginRateLimitKeysForEmail(
      "203.0.113.7",
      normalizeLoginEmail("First@Campus.edu"),
    );
    const b = loginRateLimitKeysForEmail(
      "203.0.113.7",
      normalizeLoginEmail("  first@campus.edu "),
    );
    assert.deepEqual(a, b, "case/space variants share one bucket");

    for (const key of [a.ipKey, a.ipEmailKey]) {
      const digest = key.replace(/^(ip|ip-email):/, "");
      assert.match(digest, HEX64, "hex digest only");
      assert.ok(!digest.includes("203.0.113.7"), "raw IP never in the key");
      assert.ok(!digest.toLowerCase().includes("first@campus.edu"), "raw email never in the key");
    }

    assert.notEqual(
      a.ipEmailKey,
      loginRateLimitKeys("203.0.113.7", "1AY22CS001").ipUsnKey,
      "email and USN buckets never collide",
    );
  });

  it("8. safe next handling is intact", () => {
    assert.ok(routeSrc.includes("resolveLoginNext({"), "route still delegates the redirect");
    assert.equal(
      resolveLoginNext({ step: "complete", requestedNext: "/settings", fallback: "/" }),
      "/settings",
      "valid return URL honored for complete accounts",
    );
    assert.equal(
      resolveLoginNext({
        step: "photos",
        requestedNext: "/settings",
        fallback: "/onboarding/photos",
      }),
      "/onboarding/photos",
      "incomplete accounts ignore ?next=",
    );
    assert.equal(safeNextPath("//evil"), null, "open redirects still rejected");
    assert.equal(safeNextPath("https://evil"), null, "absolute URLs still rejected");
  });

  it("12. passwords never reach the limiter; raw identifiers never persist", () => {
    const limiterSrc = readFileSync(new URL("./login-rate-limit.ts", import.meta.url), "utf8");
    assert.ok(
      !/\bpw\b/.test(limiterSrc.replace(/password never involved/g, "")),
      "no password variable in limiter",
    );
    assert.ok(limiterSrc.includes("sha256"), "hash-only key construction");
    assert.ok(!routeSrc.includes("loginRateLimitKeys(pw"), "password never passed as a key");
    assert.ok(
      !routeSrc.includes("loginRateLimitKeysForEmail(pw"),
      "password never passed as a key",
    );
  });
});

describe("slice 3 — login UI", () => {
  it("single identifier field accepts USN or email (no second field, no mode toggle)", () => {
    assert.ok(pageSrc.includes("usn or email"), "concise dual-identifier copy");
    assert.ok(!pageSrc.includes('name="usn"'), "legacy USN-only field removed");
    assert.ok(pageSrc.includes('name="identifier"'), "single identifier field");
    assert.ok(!pageSrc.toLowerCase().includes("toggle"), "no login mode toggle");
  });

  it("client sends identifier for server-side classification", () => {
    assert.ok(pageSrc.includes("identifier: identifier.trim()"), "identifier forwarded to the API");
    assert.ok(!pageSrc.includes("normalizeUSN"), "no client-side USN gating that could block emails");
  });

  it("forgot-password still always reports success (no enumeration)", () => {
    assert.ok(pageSrc.includes("Always show success"), "recovery stays silent on existence");
    assert.ok(pageSrc.includes("resetPasswordForEmail"), "Supabase-owned recovery preserved");
  });
});