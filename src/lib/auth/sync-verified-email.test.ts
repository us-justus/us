import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideOnboardingTrack } from "../onboarding/track-decision.ts";
import { retryVerifiedEmailSync } from "./retry-verified-email-sync.ts";

const ROUTE_URL = new URL(
  "../../app/api/account/sync-verified-email/route.ts",
  import.meta.url,
);
const HELPER_URL = new URL("./sync-verified-email.ts", import.meta.url);
const RETRY_URL = new URL("./retry-verified-email-sync.ts", import.meta.url);
const CONFIRM_URL = new URL("../../app/auth/confirm/route.ts", import.meta.url);
const FEEDBACK_REPLY_URL = new URL(
  "../../app/api/inside/feedback/reply/route.ts",
  import.meta.url,
);
const LOGIN_URL = new URL("../../app/api/auth/login/route.ts", import.meta.url);
const CLIENT_URL = new URL(
  "../../app/settings/account/client.tsx",
  import.meta.url,
);
const ONBOARDING_FORM_URL = new URL(
  "../../app/onboarding/password/form.tsx",
  import.meta.url,
);
const STATE_URL = new URL("../onboarding/state.ts", import.meta.url);
const MIGRATION_URL = new URL(
  "../../../supabase/migrations/20261127000002_auth_verified_email_backfill.sql",
  import.meta.url,
);

const route = readFileSync(ROUTE_URL, "utf8");
const helper = readFileSync(HELPER_URL, "utf8");
const retry = readFileSync(RETRY_URL, "utf8");
const confirm = readFileSync(CONFIRM_URL, "utf8");
const feedbackReply = readFileSync(FEEDBACK_REPLY_URL, "utf8");
const login = readFileSync(LOGIN_URL, "utf8");
const client = readFileSync(CLIENT_URL, "utf8");
const onboardingForm = readFileSync(ONBOARDING_FORM_URL, "utf8");
const state = readFileSync(STATE_URL, "utf8");
const migration = readFileSync(MIGRATION_URL, "utf8");

/**
 * Verified-email reconciliation observability (Oct 2026 incident).
 *
 * Production had Auth-confirmed / verification_records-email-empty rows
 * because the healer once 500ed on the missing service_role grant while its
 * sole client swallowed every failure. These tests pin the contract: success
 * behavior unchanged, failures generic-but-observable, server-owned writes,
 * and no change to onboarding routing semantics.
 */
describe("sync-verified-email route contract", () => {
  it("successful reconciliation still returns ok:true", () => {
    assert.ok(route.includes("return NextResponse.json({ ok: true })"), "success shape preserved");
  });

  it("requires a real confirmed Auth email before writing", () => {
    assert.ok(helper.includes("if (!user || !hasRealVerifiedEmail(user))"));
    assert.ok(helper.includes("if (!email || !confirmedAt)"));
    assert.ok(route.includes('result.reason === "unverified" ? 400 : 500'));
  });

  it("uses the Auth confirmation timestamp as the trusted proof", () => {
    assert.match(helper, /user\.email_confirmed_at \?\?/);
    assert.match(helper, /confirmed_at\?: string \| null/);
    assert.match(helper, /email_verified_at: confirmedAt/);
  });

  it("failures stay generic: no database internals reach the browser", () => {
    assert.doesNotMatch(route, /error\.message/i);
    assert.doesNotMatch(route, /error\.details/i);
    assert.doesNotMatch(route, /error\.hint/i);
    assert.doesNotMatch(route, /JSON\.stringify\(error/i);
  });

  it("failures are observable server-side with code-only logging (no identity)", () => {
    assert.equal(
      helper.match(/console\.error\("\[account\] sync-verified-email failed", /g)?.length,
      3,
      "read, upsert, and catch-all paths must all log",
    );
    assert.ok(helper.includes('readError.code ?? "unknown"'));
    assert.ok(helper.includes('error.code ?? "unknown"'));
    assert.doesNotMatch(helper, /console\.error\([^)]*user\.id/i);
    assert.doesNotMatch(helper, /console\.error\([^)]*user\.email/i);
    assert.doesNotMatch(helper, /console\.error\([^)]*user_id/i);
  });

  it("introduces no admin special-case and names no account", () => {
    for (const source of [route, helper]) {
      assert.doesNotMatch(source, /is_admin/i);
      assert.doesNotMatch(source, /admin_users/i);
      assert.doesNotMatch(source, /481827f5/i);
      assert.doesNotMatch(source, /02fe24bcs043/i);
    }
  });
});

describe("existing verified-email records", () => {
  it("backfills all confirmed registered accounts through an append-only migration", () => {
    assert.match(migration, /insert into public\.verification_records/i);
    assert.match(migration, /from auth\.users u/i);
    assert.match(migration, /coalesce\(u\.email_confirmed_at, u\.confirmed_at\)/);
    assert.match(migration, /on conflict \(user_id\) do update/i);
  });

  it("repairs missing emails, mismatched emails, and missing trust timestamps", () => {
    assert.match(migration, /public\.verification_records\.email is null/i);
    assert.match(
      migration,
      /lower\(btrim\(public\.verification_records\.email\)\) is distinct from lower\(btrim\(excluded\.email\)\)/i,
    );
    assert.match(migration, /public\.verification_records\.email_verified_at is null/i);
  });

  it("never backfills unconfirmed or internal identities", () => {
    assert.match(migration, /u\.email_confirmed_at is not null or u\.confirmed_at is not null/i);
    assert.match(migration, /lower\(btrim\(u\.email\)\) not like '%@us\.signin\.invalid'/i);
  });

  it("runtime sync is idempotent for already-correct rows", () => {
    assert.match(helper, /record\.email\.trim\(\)\.toLowerCase\(\) === email\.toLowerCase\(\)/);
    assert.match(helper, /typeof record\.email_verified_at === "string"/);
  });
});

describe("future verification flows", () => {
  it("syncs server-side immediately after either Auth confirmation callback", () => {
    assert.match(
      confirm,
      /exchangeCodeForSession\(code\)[\s\S]{0,300}syncVerifiedEmailFromUser\(data\.user\)/,
    );
    assert.match(
      confirm,
      /verifyOtp\(\{ type, token_hash \}\)[\s\S]{0,300}syncVerifiedEmailFromUser\(data\.user\)/,
    );
  });

  it("never relies on ?verified=1 as proof", () => {
    assert.match(confirm, /redirect\(`\$\{next\}\?verified=1`\)/);
    assert.ok(onboardingForm.includes('params.get("verified") === "1"'));
    assert.ok(onboardingForm.includes("await resolveState()"));
  });

  it("recovers stale records lazily when an admin reply needs the verified email", () => {
    assert.match(feedbackReply, /auth\.admin\.getUserById\(row\.user_id\)/);
    assert.match(feedbackReply, /syncVerifiedEmailFromUser\(authAccount\.user, service\)/);
    assert.match(feedbackReply, /if \(sync\.ok\)[\s\S]{0,400}refreshedVr/);
    assert.match(feedbackReply, /hasRealVerifiedEmail\(authAccount\.user\)/);
    assert.match(
      feedbackReply,
      /confirmedAuthEmail\.trim\(\)\.toLowerCase\(\) !== String\(recipient\)/,
    );
  });

  it("heals verified-email records at login without a second getUser", () => {
    assert.match(login, /await syncVerifiedEmailFromUser\(user, service\)/);
    const between = login.slice(
      login.indexOf("syncVerifiedEmailFromUser(user, service)"),
      login.indexOf("getOnboardingState(user, supabase)"),
    );
    assert.doesNotMatch(between, /auth\.getUser\(\)/);
  });

  it("manual verify-continue uses the server-owned sync instead of a client upsert", () => {
    assert.ok(client.includes("await retryVerifiedEmailSync()"));
    assert.doesNotMatch(client, /from\("verification_records"\)/);
  });
});

describe("retry/recovery", () => {
  it("bounded client retry succeeds after a transient failure", async () => {
    let calls = 0;
    const ok = await retryVerifiedEmailSync({
      attempts: 3,
      delayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: calls === 1 ? 500 : 200 });
      },
    });
    assert.equal(ok, true);
    assert.equal(calls, 2);
  });

  it("bounded client retry gives up without looping forever", async () => {
    let calls = 0;
    const ok = await retryVerifiedEmailSync({
      attempts: 3,
      delayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 503 });
      },
    });
    assert.equal(ok, false);
    assert.equal(calls, 3);
  });

  it("both verification return surfaces use the same retry helper", () => {
    assert.ok(retry.includes('fetchImpl ?? globalThis.fetch'));
    assert.ok(retry.includes('"/api/account/sync-verified-email"'));
    assert.ok(client.includes("failed = !(await retryVerifiedEmailSync())"));
    assert.ok(onboardingForm.includes("syncFailedOnLoad = !(await retryVerifiedEmailSync())"));
  });
});

describe("sync-verified-email client observability", () => {
  it("the just-verified effect distinguishes failure from success", () => {
    const idx = client.indexOf("failed = !(await retryVerifiedEmailSync())");
    assert.ok(idx !== -1, "settings still reconciles after verification");
    assert.ok(client.includes("if (failed && !cancelled) setSyncFailed(true)"));
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
    const idx = client.indexOf("failed = !(await retryVerifiedEmailSync())");
    const window = client.slice(idx, idx + 500);
    assert.doesNotMatch(window, /\.json\(\)/);
    assert.doesNotMatch(window, /error\.message/);
  });
});

describe("onboarding password step reconciliation", () => {
  it("records the Auth-confirmed address after a verification-link return", () => {
    const idx = onboardingForm.indexOf("syncFailedOnLoad = !(await retryVerifiedEmailSync())");
    assert.ok(idx !== -1, "onboarding password step must call the reconciliation helper");
    assert.match(onboardingForm.slice(Math.max(0, idx - 300), idx + 300), /if \(justVerified\)/);
  });

  it("keeps a failed reconciliation visible with a retry path", () => {
    assert.ok(onboardingForm.includes("setSyncFailed(syncFailedOnLoad)"));
    assert.ok(onboardingForm.includes("syncFailed &&"));
    assert.ok(onboardingForm.includes("Reload to retry"));
    assert.ok(
      onboardingForm.includes("if (justVerified && !syncFailedOnLoad)"),
      "success notice must not hide a failed sync",
    );
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
