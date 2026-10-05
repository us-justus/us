import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveLoginNext, safeNextPath } from "./safe-next.ts";
import type { OnboardingStepSlug as OnboardingStep } from "./onboarding-session-decision.ts";

const INCOMPLETE: OnboardingStep[] = ["usn", "email", "password", "profile", "photos"];

describe("resolveLoginNext", () => {
  it("sends every incomplete account to its onboarding step, ignoring ?next=", () => {
    for (const step of INCOMPLETE) {
      const fallback = `/onboarding/${step}`;
      for (const requestedNext of ["/home", "/settings", null, undefined, "//evil"]) {
        assert.equal(
          resolveLoginNext({ step, requestedNext, fallback }),
          fallback,
          `step ${step}, next ${String(requestedNext)}`,
        );
      }
    }
  });

  it("never renders /onboarding/usn for an account already past USN", () => {
    for (const step of ["email", "password", "profile", "photos", "complete"] as OnboardingStep[]) {
      const fallback = step === "complete" ? "/home" : `/onboarding/${step}`;
      const dest = resolveLoginNext({ step, requestedNext: "/home", fallback });
      assert.notEqual(dest, "/onboarding/usn", `step ${step}`);
    }
  });

  it("honors a valid return URL only for complete accounts", () => {
    assert.equal(
      resolveLoginNext({ step: "complete", requestedNext: "/settings", fallback: "/home" }),
      "/settings",
    );
    assert.equal(
      resolveLoginNext({ step: "complete", requestedNext: "/search", fallback: "/home" }),
      "/search",
    );
  });

  it("honors any allowlisted destination for complete accounts (no launch gating)", () => {
    for (const dest of ["/", "/home", "/search", "/profile", "/settings", "/settings/account", "/u/some_name"]) {
      assert.equal(
        resolveLoginNext({ step: "complete", requestedNext: dest, fallback: "/home" }),
        dest,
        dest,
      );
    }
  });

  it("treats invalid ?next= as absent, never an error or signal", () => {
    for (const bad of ["", "//evil", "https://evil", "javascript:alert(1)", "/login", "/onboarding/usn", "/inside", "/invite/x", "/discover", "/matches", "/chat", 42, {}, null]) {
      assert.equal(
        resolveLoginNext({ step: "complete", requestedNext: bad, fallback: "/home" }),
        "/home",
        String(bad),
      );
    }
  });
});

describe("safeNextPath", () => {
  it("accepts allowlisted product paths", () => {
    for (const ok of ["/", "/home", "/search", "/profile", "/settings/account", "/u/some_name"]) {
      assert.equal(safeNextPath(ok), ok, ok);
    }
  });

  it("rejects onboarding, auth, invite, admin, and removed post-launch paths without distinction", () => {
    for (const bad of ["/login", "/onboarding", "/onboarding/usn", "/auth/confirm", "/invite/x", "/inside", "/inside/health", "/discover", "/matches", "/notifications", "/chat", "/chat/abc-123"]) {
      assert.equal(safeNextPath(bad), null, bad);
    }
  });
});

describe("login route hardening tripwires", () => {
  const routeSrc = readFileSync(new URL("../../app/api/auth/login/route.ts", import.meta.url), "utf8");

  it("returns one generic message on every credential failure", () => {
    assert.ok(routeSrc.includes("const GENERIC = "), "GENERIC message must be defined");
    const withoutGeneric401 = routeSrc.split("{ error: GENERIC }, { status: 401 }").join("");
    assert.ok(!withoutGeneric401.includes("401"), "every 401 must use the generic message");
  });
});

describe("no new auth/token mechanism tripwire", () => {
  const hookSrc = readFileSync(new URL("./use-onboarding-session.ts", import.meta.url), "utf8");
  const decisionSrc = readFileSync(new URL("./onboarding-session-decision.ts", import.meta.url), "utf8");

  it("introduces no custom tokens, cookies, or direct sign-in calls", () => {
    for (const banned of [
      "signInWithPassword",
      "signUp(",
      "updateUser",
      "signInAnonymously",
      "refreshSession",
      "refresh_token",
      "access_token",
      "jsonwebtoken",
      "set-cookie",
      "document.cookie",
    ]) {
      assert.ok(!hookSrc.includes(banned), `hook must not contain ${banned}`);
      assert.ok(!decisionSrc.includes(banned), `decision must not contain ${banned}`);
    }
  });

  it("keeps the canonical identity as the server-side auth user", () => {
    assert.ok(hookSrc.includes("/api/account/state"), "server remains the authority");
    assert.ok(hookSrc.includes("getExistingSession"), "returning accounts never mint");
    assert.ok(hookSrc.includes("ensureAnonymousSession"), "anonymous onboarding preserved");
  });
});
