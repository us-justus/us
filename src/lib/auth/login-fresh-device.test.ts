import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideOnboardingTrack } from "../onboarding/track-decision.ts";
import { resolveLoginNext } from "./safe-next.ts";

const ROUTE_URL = new URL("../../app/api/auth/login/route.ts", import.meta.url);
const STATE_URL = new URL("../onboarding/state.ts", import.meta.url);
const routeSrc = readFileSync(ROUTE_URL, "utf8");
const stateSrc = readFileSync(STATE_URL, "utf8");

/**
 * Fresh-device login regression (Client-A / Client-B split).
 *
 * Failure mode: POST /api/auth/login authenticates on one SSR client
 * (Client A, holding the just-established session in memory) but resolved
 * onboarding state through a second, freshly-created cookie-derived client
 * (Client B). On a cookie-less fresh-device request Client B reads
 * verification_records as anon → RLS yields zero rows → vr === null →
 * step "usn" → /onboarding/usn for an existing complete account.
 *
 * The wiring assertions below fail on the split code and pass once the
 * login route reuses its authenticated client for state resolution. The
 * behavioral assertions pin the consequence using the real pure helpers.
 */
describe("fresh-device login reuses the authenticated client", () => {
  it("login resolves onboarding state on its sign-in client, not a fresh cookie client", () => {
    assert.ok(
      routeSrc.includes("getOnboardingState(user, supabase)"),
      "respondWithDestination must pass its authenticated supabase client into getOnboardingState",
    );
  });

  it("getOnboardingState honors an injected authenticated client", () => {
    assert.match(
      stateSrc,
      /knownUser\?: User \| null,\s*\n\s*client\?:/,
      "getOnboardingState must accept an injected client alongside the known user",
    );
    assert.ok(
      stateSrc.includes("client ?? (await createClient())"),
      "injected client must win; fresh cookie client is only the fallback",
    );
  });

  it("login mints no second cookie client between sign-in and state resolution", () => {
    const signInIdx = routeSrc.indexOf("await supabase.auth.signInWithPassword");
    const stateIdx = routeSrc.indexOf("getOnboardingState(user, supabase)");
    assert.ok(signInIdx > 0 && stateIdx > signInIdx, "sign-in must precede state resolution");
    const between = routeSrc.slice(signInIdx, stateIdx);
    assert.ok(
      !between.includes("createClient()"),
      "no fresh createClient() between signInWithPassword and getOnboardingState",
    );
  });
});

describe("fresh-device consequence (real pure helpers)", () => {
  it("anon Client-B read (no row) resolves to usn and /onboarding/usn", () => {
    // Client B on a cookie-less request: RLS filters every row, maybeSingle
    // returns null data with no error → vr === null → hasRecord false.
    const decision = decideOnboardingTrack({
      hasRecord: false,
      usn: null,
      email: null,
      emailSkipped: false,
    });
    assert.equal(decision.step, "usn");
    assert.equal(
      resolveLoginNext({ step: "usn", requestedNext: "/home", fallback: "/onboarding/usn" }),
      "/onboarding/usn",
      "incomplete step ignores ?next= and lands on /onboarding/usn",
    );
  });

  it("authenticated Client-A read (row present) advances past usn", () => {
    const decision = decideOnboardingTrack({
      hasRecord: true,
      usn: "1AY22CS001",
      email: "user@campus.edu",
      emailSkipped: false,
    });
    assert.equal(decision.step, "beyond-email");
  });

  it("complete step honors an allowlisted destination instead of onboarding", () => {
    assert.equal(
      resolveLoginNext({ step: "complete", requestedNext: "/search", fallback: "/home" }),
      "/search",
    );
  });
});
