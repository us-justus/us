import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideOnboardingSession,
  type OnboardingBrowserSnapshot,
  type OnboardingServerSnapshot,
  type OnboardingStepSlug,
} from "./onboarding-session-decision.ts";

const PAST_USN_STEPS: OnboardingStepSlug[] = ["email", "password", "profile", "photos", "complete"];

const BROWSER_VARIANTS: { name: string; browser: OnboardingBrowserSnapshot }[] = [
  { name: "unknown browser session", browser: null },
  { name: "no browser session", browser: { hasSession: false, isAnonymous: false } },
  { name: "stale anonymous browser session", browser: { hasSession: true, isAnonymous: true } },
  { name: "permanent browser session", browser: { hasSession: true, isAnonymous: false } },
];

function permanentServer(step: OnboardingStepSlug | null, next: string | null): OnboardingServerSnapshot {
  return { signedIn: true, accountKind: "permanent-verified", step, next };
}

describe("decideOnboardingSession", () => {
  it("lets a new anonymous user submit USN (signed-out server)", () => {
    const d = decideOnboardingSession({
      expectedStep: "usn",
      server: { signedIn: false, accountKind: null, step: null, next: null },
      browser: null,
    });
    assert.equal(d.mode, "anonymous");
    assert.equal(d.redirectTo, null);
    assert.equal(d.allowSubmit, true);
  });

  it("lets a new anonymous user submit USN (anonymous server identity)", () => {
    const d = decideOnboardingSession({
      expectedStep: "usn",
      server: { signedIn: true, accountKind: "anonymous", step: "usn", next: "/onboarding/usn" },
      browser: { hasSession: true, isAnonymous: true },
    });
    assert.equal(d.mode, "anonymous");
    assert.equal(d.redirectTo, null);
    assert.equal(d.allowSubmit, true);
  });

  it("falls back to anonymous bootstrap when server state is unreachable", () => {
    const d = decideOnboardingSession({ expectedStep: "usn", server: null, browser: null });
    assert.equal(d.mode, "anonymous");
    assert.equal(d.redirectTo, null);
    assert.equal(d.allowSubmit, true);
  });

  it("redirects a returning permanent account past USN to the server destination", () => {
    for (const step of PAST_USN_STEPS) {
      const next = step === "complete" ? "/discover" : `/onboarding/${step}`;
      const d = decideOnboardingSession({
        expectedStep: "usn",
        server: permanentServer(step, next),
        browser: { hasSession: true, isAnonymous: true },
      });
      assert.equal(d.mode, "existing", `step ${step}`);
      assert.equal(d.redirectTo, next, `step ${step}`);
      assert.equal(d.allowSubmit, false, `step ${step}`);
    }
  });

  it("never mints anonymous for a returning account, whatever the browser holds", () => {
    for (const { name, browser } of BROWSER_VARIANTS) {
      const d = decideOnboardingSession({
        expectedStep: "usn",
        server: permanentServer("profile", "/onboarding/profile"),
        browser,
      });
      assert.notEqual(d.mode, "anonymous", name);
      assert.equal(d.redirectTo, "/onboarding/profile", name);
      assert.equal(d.allowSubmit, false, name);
    }
  });

  it("blocks submit on every UID-mismatch combination (stale anonymous browser, permanent server)", () => {
    for (const step of PAST_USN_STEPS) {
      const next = step === "complete" ? "/discover" : `/onboarding/${step}`;
      for (const { name, browser } of BROWSER_VARIANTS) {
        const d = decideOnboardingSession({ expectedStep: "usn", server: permanentServer(step, next), browser });
        assert.equal(d.allowSubmit, false, `step ${step}, ${name}`);
        assert.ok(d.redirectTo, `step ${step}, ${name}`);
      }
    }
  });

  it("resumes (never mints) a permanent account genuinely on the USN step", () => {
    const d = decideOnboardingSession({
      expectedStep: "usn",
      server: permanentServer("usn", "/onboarding/usn"),
      browser: { hasSession: true, isAnonymous: false },
    });
    assert.equal(d.mode, "existing");
    assert.equal(d.redirectTo, null);
    assert.equal(d.allowSubmit, true);
  });

  it("builds a step fallback when the server destination is missing", () => {
    const d = decideOnboardingSession({
      expectedStep: "usn",
      server: permanentServer("photos", null),
      browser: null,
    });
    assert.equal(d.redirectTo, "/onboarding/photos");
    assert.equal(d.allowSubmit, false);
  });

  it("never returns submit-allowed together with a redirect", () => {
    const servers: (OnboardingServerSnapshot | null)[] = [
      null,
      { signedIn: false, accountKind: null, step: null, next: null },
      { signedIn: true, accountKind: "anonymous", step: "usn", next: "/onboarding/usn" },
      ...PAST_USN_STEPS.map((step) =>
        permanentServer(step, step === "complete" ? "/discover" : `/onboarding/${step}`),
      ),
      permanentServer("usn", "/onboarding/usn"),
      permanentServer(null, null),
    ];
    for (const server of servers) {
      for (const { name, browser } of BROWSER_VARIANTS) {
        const d = decideOnboardingSession({ expectedStep: "usn", server, browser });
        if (d.redirectTo) assert.equal(d.allowSubmit, false, `${JSON.stringify(server)}, ${name}`);
      }
    }
  });
});
