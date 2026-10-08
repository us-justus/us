import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveLoginNext, safeNextPath } from "./safe-next.ts";
import {
  decideLoginEntry,
  showLoginGuestNotice,
  toLoginServerSnapshot,
  type LoginServerSnapshot,
} from "./login-entry-decision.ts";
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

describe("no new auth/token mechanism tripwire", () => {  const hookSrc = readFileSync(new URL("./use-onboarding-session.ts", import.meta.url), "utf8");
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

const LOGIN_PAGE_URL = new URL("../../app/login/page.tsx", import.meta.url);
const loginPageSrc = readFileSync(LOGIN_PAGE_URL, "utf8");

/**
 * Login-entry regression: an anonymous Supabase session is an onboarding
 * identity, never a sign-in. `/login` must render its credential form for
 * anonymous/absent/unknown server states and resume only for a
 * server-confirmed non-anonymous account.
 *
 * Production failure mode (fixed): the entry gate trusted the raw browser
 * `user.is_anonymous` bit, so any classification skew sent anonymous
 * holders through SignedInContinue, which read `next` from
 * /api/account/state (signedIn:true + next:/onboarding/email for anonymous)
 * and router.replace()d away without ever rendering the form.
 */
describe("login entry decision (real pure helper)", () => {
  function anonymousSnapshot(): LoginServerSnapshot {
    return { signedIn: true, accountKind: "anonymous" };
  }

  it("TEST 1: anonymous at the email step renders the form, never resumes", () => {
    // Server payload for the incident state: anonymous UID with a USN row
    // but no recorded email → onboardingStep email, next /onboarding/email.
    assert.equal(decideLoginEntry(anonymousSnapshot()), "form");
  });

  it("TEST 2: anonymous at the usn step renders the form, never resumes", () => {
    assert.equal(decideLoginEntry(anonymousSnapshot()), "form");
  });

  it("TEST 3: anonymous at the password step renders the form, never resumes", () => {
    assert.equal(decideLoginEntry(anonymousSnapshot()), "form");
  });

  it("TEST 4: permanent-verified complete account keeps resume behavior", () => {
    assert.equal(
      decideLoginEntry({ signedIn: true, accountKind: "permanent-verified" }),
      "continue",
    );
    assert.equal(
      resolveLoginNext({ step: "complete", requestedNext: null, fallback: "/home" }),
      "/home",
      "complete resume still lands on /home",
    );
  });

  it("TEST 5: permanent incomplete account keeps resume behavior", () => {
    assert.equal(
      decideLoginEntry({ signedIn: true, accountKind: "permanent-unverified" }),
      "continue",
    );
    assert.equal(
      resolveLoginNext({ step: "profile", requestedNext: "/home", fallback: "/onboarding/profile" }),
      "/onboarding/profile",
      "incomplete resume still lands on its onboarding step, ignoring ?next=",
    );
  });

  it("TEST 6: no session renders the form with no redirect", () => {
    assert.equal(decideLoginEntry(null), "form");
    assert.equal(decideLoginEntry({ signedIn: false, accountKind: null }), "form");
  });

  it("TEST 7: stale/missing browser anonymity bit cannot cause a redirect", () => {
    // The decision takes ONLY the server snapshot — there is no parameter
    // for the browser user, so a stale or missing client-side
    // `user.is_anonymous` is structurally unable to influence navigation.
    // Whatever the browser believed, a server-confirmed anonymous kind
    // renders the form.
    assert.equal(decideLoginEntry(anonymousSnapshot()), "form");
    assert.equal(decideLoginEntry({ signedIn: true, accountKind: null }), "form");
  });

  it("guest notice follows the server kind, never the browser bit", () => {
    assert.equal(showLoginGuestNotice(anonymousSnapshot()), true);
    assert.equal(showLoginGuestNotice({ signedIn: true, accountKind: "permanent-verified" }), false);
    assert.equal(showLoginGuestNotice({ signedIn: false, accountKind: null }), false);
    assert.equal(showLoginGuestNotice(null), false);
  });

  it("toLoginServerSnapshot projects the account-state payload, failing open", () => {
    assert.deepEqual(
      toLoginServerSnapshot(true, { signedIn: true, account: { kind: "anonymous" } }),
      { signedIn: true, accountKind: "anonymous" },
    );
    assert.deepEqual(
      toLoginServerSnapshot(true, { signedIn: true, account: { kind: "permanent-verified" } }),
      { signedIn: true, accountKind: "permanent-verified" },
    );
    // Failed fetches and signed-out payloads project to null; payloads
    // with a missing/unrecognized kind project with a null kind — and both
    // shapes always decide "form" (fail open to the credential form).
    assert.equal(toLoginServerSnapshot(false, { signedIn: true, account: { kind: "anonymous" } }), null);
    assert.equal(toLoginServerSnapshot(true, { signedIn: false }), null);
    assert.equal(toLoginServerSnapshot(true, null), null);
    assert.deepEqual(
      toLoginServerSnapshot(true, { signedIn: true, account: {} }),
      { signedIn: true, accountKind: null },
    );
    assert.deepEqual(
      toLoginServerSnapshot(true, { signedIn: true }),
      { signedIn: true, accountKind: null },
    );
    assert.equal(decideLoginEntry(toLoginServerSnapshot(true, { signedIn: true })), "form");
    assert.equal(decideLoginEntry(toLoginServerSnapshot(false, null)), "form");
  });
});

describe("login entry wiring tripwires", () => {
  it("entry gate decides via the server account kind, never raw anonymity", () => {
    assert.ok(loginPageSrc.includes("decideLoginEntry"), "gate must use the pure entry decision");
    assert.ok(loginPageSrc.includes("toLoginServerSnapshot"), "gate must project the server payload");
    assert.ok(
      loginPageSrc.includes('"/api/account/state"'),
      "gate must resolve the server kind before deciding",
    );
    assert.ok(
      !loginPageSrc.includes(".is_anonymous"),
      "navigation must never read the raw browser anonymity bit",
    );
  });

  it("resume branch reuses one snapshot and keeps existing destination rules", () => {
    assert.ok(loginPageSrc.includes("preloaded"), "resume must reuse the gate snapshot (no second fetch)");
    assert.ok(loginPageSrc.includes("router.replace(dest)"), "resume navigation preserved");
    assert.ok(
      loginPageSrc.includes('if (candidate && j?.onboardingStep === "complete")'),
      "?next= stays honored for complete accounts only",
    );
    assert.ok(loginPageSrc.includes('router.replace("/suspended")'), "suspended routing preserved");
  });

  it("login still never mints an anonymous session", () => {
    assert.ok(!loginPageSrc.includes("ensureAnonymousSession()"), "login must never establish a session");
    assert.ok(!loginPageSrc.includes("signInAnonymously"), "login must never sign in anonymously");
  });
});

/**
 * Live-incident lifecycle regression (Oct 2026): `/login` mounted, rendered
 * briefly, then router.replace()d to `/onboarding/email` after ~1s in a real
 * Safari session — despite the pure `decideLoginEntry("anonymous") === "form"`
 * unit tests passing.
 *
 * Root cause class: the tests below previously exercised ONLY the pure helper
 * and substring tripwires, never the LoginFlow → SignedInContinue boundary.
 * The resume component (`SignedInContinue`) called `router.replace(dest)` with
 * `dest` taken straight from the payload's `next` field on mount authority
 * alone — it never re-validated `account.kind` at the navigation site itself.
 *
 * These tests pin the FULL entry lifecycle composition the page now executes:
 *
 *   gate (LoginFlow):  snapshot = toLoginServerSnapshot(res.ok, payload);
 *                       mount SignedInContinue iff decideLoginEntry(snapshot)
 *                         === "continue", else render the credential form.
 *   nav-site (SignedInContinue): re-project the exact navigated-from payload
 *                       and call router.replace() ONLY when the re-check also
 *                       says "continue"; otherwise report back (onNotResumable)
 *                       so the page renders the form with zero navigation.
 */
type AccountStatePayload = {
  signedIn?: unknown;
  account?: { kind?: unknown } | null;
  suspended?: unknown;
  next?: unknown;
  onboardingStep?: unknown;
};

/** Mirror of the LoginFlow mount gate in src/app/login/page.tsx. */
function gateMountDecision(ok: boolean, payload: AccountStatePayload | null): "form" | "continue" {
  return decideLoginEntry(toLoginServerSnapshot(ok, payload)) === "continue" ? "continue" : "form";
}

/**
 * Mirror of the SignedInContinue navigation-site re-verification in
 * src/app/login/page.tsx. Returns the destination router.replace() would be
 * called with, or null when it must NOT navigate (form fallback instead).
 */
function navSiteDestination(
  ok: boolean,
  payload: AccountStatePayload | null,
): string | null {
  if (payload?.suspended === true) return "/suspended";
  if (decideLoginEntry(toLoginServerSnapshot(ok, payload)) !== "continue") return null;
  const next: unknown = payload?.next;
  return typeof next === "string" ? next : "/onboarding";
}

describe("login entry lifecycle (gate + navigation site)", () => {
  // Exact production payload shape from the incident: an anonymous onboarding
  // identity at the email step. /api/account/state reports signedIn:true for
  // anonymous identities, with the server-decided next pointing at the step.
  const ANONYMOUS_EMAIL_STEP: AccountStatePayload = {
    signedIn: true,
    account: { kind: "anonymous" },
    onboardingStep: "email",
    next: "/onboarding/email",
  };

  it("LIFECYCLE 1: anonymous at email step renders the form; router.replace never fires", () => {
    // Gate: no SignedInContinue mount.
    assert.equal(gateMountDecision(true, ANONYMOUS_EMAIL_STEP), "form");
    // Nav-site: even if mounted with this payload, no destination exists —
    // the component reports back and the page renders the form.
    assert.equal(navSiteDestination(true, ANONYMOUS_EMAIL_STEP), null);
    // Guest notice accompanies the form for this exact state.
    assert.equal(
      showLoginGuestNotice(toLoginServerSnapshot(true, ANONYMOUS_EMAIL_STEP)),
      true,
    );
  });

  it("LIFECYCLE 2: permanent-verified complete account keeps resume to /home", () => {
    const payload: AccountStatePayload = {
      signedIn: true,
      account: { kind: "permanent-verified" },
      onboardingStep: "complete",
      next: "/home",
    };
    assert.equal(gateMountDecision(true, payload), "continue");
    assert.equal(navSiteDestination(true, payload), "/home");
  });

  it("LIFECYCLE 3: permanent-incomplete account keeps resume to its step", () => {
    const payload: AccountStatePayload = {
      signedIn: true,
      account: { kind: "permanent-unverified" },
      onboardingStep: "profile",
      next: "/onboarding/profile",
    };
    assert.equal(gateMountDecision(true, payload), "continue");
    assert.equal(navSiteDestination(true, payload), "/onboarding/profile");
  });

  it("LIFECYCLE 4: no session renders the form; nothing mounts, nothing navigates", () => {
    assert.equal(gateMountDecision(true, { signedIn: false }), "form");
    assert.equal(navSiteDestination(true, { signedIn: false }), null);
    assert.equal(gateMountDecision(true, null), "form");
    assert.equal(navSiteDestination(true, null), null);
  });

  it("LIFECYCLE 5: failed account-state resolution fails open to the form", () => {
    assert.equal(gateMountDecision(false, ANONYMOUS_EMAIL_STEP), "form");
    assert.equal(navSiteDestination(false, ANONYMOUS_EMAIL_STEP), null);
    assert.equal(gateMountDecision(false, null), "form");
    assert.equal(navSiteDestination(false, null), null);
  });

  it("LIFECYCLE 6: missing/unrecognized kind fails open to the form", () => {
    for (const payload of [
      { signedIn: true, account: null, onboardingStep: "email", next: "/onboarding/email" },
      { signedIn: true, onboardingStep: "email", next: "/onboarding/email" },
      { signedIn: true, account: {}, onboardingStep: "email", next: "/onboarding/email" },
      { signedIn: true, account: { kind: 42 }, onboardingStep: "email", next: "/onboarding/email" },
    ] as AccountStatePayload[]) {
      assert.equal(gateMountDecision(true, payload), "form", JSON.stringify(payload));
      assert.equal(navSiteDestination(true, payload), null, JSON.stringify(payload));
    }
  });
});

describe("login navigation-site wiring tripwires", () => {
  it("resume component re-validates the account kind before router.replace", () => {
    // The guard must exist and must precede the navigation call lexically.
    const guardIdx = loginPageSrc.indexOf('decideLoginEntry(snapshot) !== "continue"');
    const navIdx = loginPageSrc.indexOf("router.replace(dest)");
    assert.ok(guardIdx !== -1, "SignedInContinue must re-check decideLoginEntry at the navigation site");
    assert.ok(navIdx !== -1, "resume navigation preserved");
    assert.ok(guardIdx < navIdx, "kind re-check must precede router.replace(dest)");
    assert.ok(
      loginPageSrc.includes("toLoginServerSnapshot(ok, j)"),
      "nav-site must re-project the exact navigated-from payload",
    );
  });

  it("kind mismatch falls back to the credential form with zero navigation", () => {
    assert.ok(loginPageSrc.includes("onNotResumable"), "mismatch must report back to the entry gate");
    assert.ok(
      loginPageSrc.includes("onNotResumable(snapshot)"),
      "mismatch must hand the snapshot back so the form renders",
    );
    // The mismatch path returns before any router.replace in the same effect:
    // between the guard and the navigation there is no other replace call.
    const guardIdx = loginPageSrc.indexOf('decideLoginEntry(snapshot) !== "continue"');
    const navIdx = loginPageSrc.indexOf("router.replace(dest)");
    const between = loginPageSrc.slice(guardIdx, navIdx);
    assert.ok(!between.includes("router.replace"), "no navigation may fire on the mismatch path");
    assert.ok(!between.includes("router.push"), "no navigation may fire on the mismatch path");
    assert.ok(!between.includes("window.location"), "no navigation may fire on the mismatch path");
  });
});
