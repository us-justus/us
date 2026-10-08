import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideOnboardingTrack } from "../onboarding/track-decision.ts";

const ROUTE_URL = new URL(
  "../../app/api/account/sync-verified-email/route.ts",
  import.meta.url,
);
const CLIENT_URL = new URL(
  "../../app/settings/account/client.tsx",
  import.meta.url,
);
const STATE_URL = new URL("../onboarding/state.ts", import.meta.url);

const route = readFileSync(ROUTE_URL, "utf8");
const client = readFileSync(CLIENT_URL, "utf8");
const state = readFileSync(STATE_URL, "utf8");

/**
 * Verified-email reconciliation observability (Oct 2026 incident).
 *
 * Production had Auth-confirmed / verification_records-email-empty rows
 * because POST /api/account/sync-verified-email — the intended healer —
 * 500ed on the missing service_role grant while its sole client swallowed
 * every failure. These tests pin the contract: success behavior unchanged,
 * failures generic-but-observable on both sides of the boundary, and no
 * change to onboarding routing semantics (no Auth-aware routing, no admin
 * bypass).
 */
describe("sync-verified-email route contract", () => {
  it("successful reconciliation still returns ok:true", () => {
    assert.ok(route.includes("return NextResponse.json({ ok: true })"), "success shape preserved");
  });

  it("requires a confirmed Auth email before writing (400 otherwise)", () => {
    assert.ok(
      route.includes("if (!user || !email || !user.email_confirmed_at)"),
      "unconfirmed/absent identity still rejected",
    );
  });

  it("failures stay generic: no database internals reach the browser", () => {
    assert.doesNotMatch(route, /error\.message/i);
    assert.doesNotMatch(route, /error\.details/i);
    assert.doesNotMatch(route, /error\.hint/i);
    assert.doesNotMatch(route, /JSON\.stringify\(error/i);
  });

  it("failures are observable server-side with code-only logging (no identity)", () => {
    // Both failure paths log the database error code and nothing else.
    assert.equal(
      route.match(/console\.error\("\[account\] sync-verified-email failed", /g)?.length,
      2,
      "upsert-error and catch-all paths must both log",
    );
    assert.ok(route.includes('error.code ?? "unknown"'), "upsert path logs the code");
    assert.doesNotMatch(route, /console\.error\([^)]*user\.id/i);
    assert.doesNotMatch(route, /console\.error\([^)]*user\.email/i);
    assert.doesNotMatch(route, /console\.error\([^)]*user_id/i);
  });

  it("introduces no admin special-case and names no account", () => {
    assert.doesNotMatch(route, /is_admin/i);
    assert.doesNotMatch(route, /admin_users/i);
    assert.doesNotMatch(route, /481827f5/i);
  });
});

describe("sync-verified-email client observability", () => {
  it("the just-verified effect distinguishes failure from success", () => {
    const idx = client.indexOf("/api/account/sync-verified-email");
    assert.ok(idx !== -1, "settings still reconciles after verification");
    const window = client.slice(idx, idx + 600);
    assert.ok(window.includes("!res.ok"), "non-OK responses must be detected");
  });

  it("a failed sync renders a visible retry notice, never silent", () => {
    assert.ok(client.includes("setSyncFailed(true)"), "failure state must be recorded");
    assert.ok(client.includes("syncFailed"), "failure state must be rendered");
    assert.ok(
      client.includes("Reload to retry"),
      "notice must offer the retry path (?verified=1 persists)",
    );
  });

  it("the notice leaks no server internals", () => {
    // The rendered notice is a static string: the effect never parses the
    // sync response body and never interpolates a server error into UI.
    const idx = client.indexOf("/api/account/sync-verified-email");
    const window = client.slice(idx, idx + 600);
    assert.doesNotMatch(window, /\.json\(\)/);
    assert.doesNotMatch(window, /error\.message/);
  });
});

describe("onboarding routing semantics unchanged (no Auth-aware routing)", () => {
  it("a missing recorded email still resolves to the email step", () => {
    assert.deepEqual(
      decideOnboardingTrack({ hasRecord: true, usn: "1AY22CS001", email: null, emailSkipped: false }),
      { track: "normal", step: "email", emailRequired: true },
    );
    assert.deepEqual(
      decideOnboardingTrack({ hasRecord: true, usn: null, email: null, emailSkipped: false }),
      { track: "email-first", step: "email", emailRequired: true },
    );
    // Legacy skip rows included: still the email step, never a bypass.
    assert.deepEqual(
      decideOnboardingTrack({ hasRecord: true, usn: "1AY22CS001", email: null, emailSkipped: true }),
      { track: "normal", step: "email", emailRequired: true },
    );
  });

  it("a recorded email still advances beyond the email step", () => {
    assert.equal(
      decideOnboardingTrack({ hasRecord: true, usn: "1AY22CS001", email: "a@campus.edu", emailSkipped: false }).step,
      "beyond-email",
    );
  });

  it("state resolution introduces no admin bypass and names no account", () => {
    assert.doesNotMatch(state, /is_admin/i);
    assert.doesNotMatch(state, /admin_users/i);
    assert.doesNotMatch(state, /481827f5/i);
  });
});
