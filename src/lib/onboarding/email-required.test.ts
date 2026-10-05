import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideOnboardingTrack, isEmailSkipAllowed } from "./track-decision.ts";
import { decideVerifiedEmailForWrite } from "./require-verified-email.ts";
import { getAccountState, hasRealVerifiedEmail } from "../auth/account.ts";
import { isInternalEmail } from "../auth/internal-email.ts";

/**
 * EMAIL IS REQUIRED AND MUST BE VERIFIED FOR EVERY USER.
 *
 * Cases mirror the product task:
 *  1. USN user attempts to skip email → impossible / rejected
 *  2. USN user supplies email but does not verify → cannot reach completion
 *  3. USN user verifies email → can continue
 *  4. USN user completes password/profile/photos → complete (via guards)
 *  5. First-year user without USN → email required
 *  6. First-year user without verified email → cannot complete
 *  7. Fake `emailVerified=true` → server rejects unless Auth confirms
 *  8. Legacy skipped-email state → documented, never created anew
 */

function authUser(opts: {
  anonymous?: boolean;
  email?: string | null;
  confirmed?: boolean;
}): Parameters<typeof hasRealVerifiedEmail>[0] {
  const u = {
    id: "00000000-0000-4000-8000-000000000000",
    is_anonymous: opts.anonymous === true,
    email: opts.email ?? null,
    email_confirmed_at: opts.confirmed ? "2026-01-01T00:00:00Z" : null,
    confirmed_at: opts.confirmed ? "2026-01-01T00:00:00Z" : null,
  };
  return u as unknown as Parameters<typeof hasRealVerifiedEmail>[0];
}

describe("CASE 1: USN user attempts to skip email → impossible / rejected", () => {
  it("pure track: legacy skip flag never advances past email", () => {
    const d = decideOnboardingTrack({
      hasRecord: true,
      usn: "1AY22CS001",
      email: null,
      emailSkipped: true,
    });
    assert.equal(d.step, "email");
    assert.equal(d.emailRequired, true);
  });

  it("skip helper never allows skip", () => {
    assert.equal(isEmailSkipAllowed({ usn: "1AY22CS001" }), false);
  });

  it("POST /api/onboarding/email { skip: true } is rejected, never recorded", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../app/api/onboarding/email/route.ts", import.meta.url),
      "utf8",
    );
    assert.ok(src.includes("status: 410"), "skip must be rejected with 410");
    assert.ok(
      !src.includes("email_skipped: true }"),
      "server must never record a new skip",
    );
  });

  it("email form exposes no skip UI", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../app/onboarding/email/form.tsx", import.meta.url),
      "utf8",
    );
    for (const banned of ["skip for now", "emailSkipped", "skipping", "— optional", "Optional"]) {
      assert.ok(!src.includes(banned), `email form must not contain ${banned}`);
    }
  });
});

describe("CASE 2: USN user supplies email but does not verify → cannot complete", () => {
  it("track advances beyond email, but the Auth gate still blocks", () => {
    const d = decideOnboardingTrack({
      hasRecord: true,
      usn: "1AY22CS001",
      email: "a@campus.edu",
      emailSkipped: false,
    });
    assert.equal(d.step, "beyond-email");
    // Unverified identities fail the canonical check:
    assert.equal(hasRealVerifiedEmail(authUser({ email: "a@campus.edu", confirmed: false })), false);
    assert.equal(hasRealVerifiedEmail(authUser({ anonymous: true })), false);
  });

  it("write guard rejects unverified accounts even with a recorded email", () => {
    const anon = authUser({ anonymous: true });
    assert.deepEqual(
      decideVerifiedEmailForWrite({ hasSession: true, recordedEmail: "a@campus.edu", authUser: anon }).ok,
      false,
    );
    const unverified = authUser({ email: "a@campus.edu", confirmed: false });
    assert.equal(
      decideVerifiedEmailForWrite({
        hasSession: true,
        recordedEmail: "a@campus.edu",
        authUser: unverified,
      }).ok,
      false,
    );
  });

  it("state machine gates profile behind real verification (no grandfathering)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./state.ts", import.meta.url), "utf8");
    assert.ok(src.includes("hasRealVerifiedEmail"), "state must use the canonical Auth check");
    assert.ok(!src.includes("grandfathered past"), "unverified grandfathering must be gone");
  });
});

describe("CASE 3: USN user verifies email → can continue", () => {
  it("verified real email passes the canonical check", () => {
    assert.equal(hasRealVerifiedEmail(authUser({ email: "a@campus.edu", confirmed: true })), true);
  });

  it("write guard allows verified accounts with a recorded email", () => {
    const verified = authUser({ email: "a@campus.edu", confirmed: true });
    assert.deepEqual(
      decideVerifiedEmailForWrite({ hasSession: true, recordedEmail: "a@campus.edu", authUser: verified }),
      { ok: true },
    );
  });

  it("password step resolves verified users to the password entry (not back to email)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../app/onboarding/password/form.tsx", import.meta.url),
      "utf8",
    );
    assert.ok(src.includes('setPhase("password")'), "verified phase must exist");
    assert.ok(src.includes('router.replace("/onboarding/email")'), "missing email still returns to email");
  });
});

describe("CASE 4: password/profile/photos completion requires verification", () => {
  it("profile + photos APIs enforce the verified-email guard", async () => {
    const { readFileSync } = await import("node:fs");
    const profile = readFileSync(
      new URL("../../app/api/onboarding/profile/route.ts", import.meta.url),
      "utf8",
    );
    const photos = readFileSync(
      new URL("../../app/api/onboarding/photos/route.ts", import.meta.url),
      "utf8",
    );
    for (const [name, src] of [["profile", profile], ["photos", photos]] as const) {
      assert.ok(
        src.includes("requireVerifiedEmailForWrite"),
        `${name} route must enforce the verified-email guard`,
      );
    }
  });

  it("completion requires profile + photos on top of verification (state tail intact)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./state.ts", import.meta.url), "utf8");
    assert.ok(src.includes('done("profile")'), "profile tail must remain");
    assert.ok(src.includes('done("photos")'), "photos tail must remain");
    assert.ok(src.includes('done("complete")'), "complete tail must remain");
  });
});

describe("CASE 5: first-year user without USN → email required", () => {
  it("marker row resolves to the email step with emailRequired", () => {
    assert.deepEqual(decideOnboardingTrack({ hasRecord: true, usn: null, email: null, emailSkipped: false }), {
      track: "email-first",
      step: "email",
      emailRequired: true,
    });
  });

  it("email API always reports emailRequired", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../app/api/onboarding/email/route.ts", import.meta.url),
      "utf8",
    );
    assert.ok(!src.includes("emailRequired: !usnPresent"), "emailRequired must not depend on USN");
    assert.ok(src.includes("emailRequired: true"), "emailRequired must always be true");
  });
});

describe("CASE 6: first-year user without verified email → cannot complete", () => {
  it("write guard rejects missing/unverified emails on the email-first track", () => {
    const anon = authUser({ anonymous: true });
    assert.equal(
      decideVerifiedEmailForWrite({ hasSession: true, recordedEmail: null, authUser: anon }).ok,
      false,
    );
    const unverified = authUser({ email: "first@campus.edu", confirmed: false });
    assert.equal(
      decideVerifiedEmailForWrite({
        hasSession: true,
        recordedEmail: "first@campus.edu",
        authUser: unverified,
      }).ok,
      false,
    );
    const verified = authUser({ email: "first@campus.edu", confirmed: true });
    assert.deepEqual(
      decideVerifiedEmailForWrite({
        hasSession: true,
        recordedEmail: "first@campus.edu",
        authUser: verified,
      }),
      { ok: true },
    );
  });
});

describe("CASE 7: fake emailVerified=true → server rejects unless Auth confirms", () => {
  it("no client flag is trusted: state + guards read Auth only", async () => {
    const { readFileSync } = await import("node:fs");
    const state = readFileSync(new URL("./state.ts", import.meta.url), "utf8");
    const guard = readFileSync(new URL("./require-verified-email.ts", import.meta.url), "utf8");
    // Real trust patterns: reading a verification flag off the request body
    // or query. (Doc comments naming the flags are fine — these patterns
    // only match actual reads.)
    for (const banned of ["body?.emailVerified", "body?.verified", "body?.email_verified", "searchParams.get(\"verified\")"]) {
      assert.ok(!state.includes(banned), `state must not trust ${banned}`);
      assert.ok(!guard.includes(banned), `guard must not trust ${banned}`);
    }
    // Neither file reads a request body at all (state takes knownUser, the
    // guard takes the Auth user + a server-loaded row).
    assert.ok(!guard.includes("req.json"), "guard must never read the request body");
    assert.ok(state.includes("knownUser"), "state must reuse the server Auth user");
    assert.ok(guard.includes("hasRealVerifiedEmail"), "guard must use the canonical Auth check");
  });

  it("getAccountState derives confirmation from Auth timestamps only", () => {
    const confirmed = getAccountState(authUser({ email: "a@campus.edu", confirmed: true }));
    assert.equal(confirmed?.kind, "permanent-verified");
    assert.equal(confirmed?.emailConfirmed, true);
    const pending = getAccountState(authUser({ email: "a@campus.edu", confirmed: false }));
    assert.equal(pending?.kind, "permanent-unverified");
  });
});

describe("CASE 8: legacy skipped-email state is documented, never created", () => {
  it("internal identities are recognized and never count as real emails", () => {
    assert.equal(isInternalEmail("u-00000000000040008000000000000000@us.signin.invalid"), true);
    assert.equal(isInternalEmail("a@campus.edu"), false);
    assert.equal(
      hasRealVerifiedEmail(authUser({ email: "u-00000000000040008000000000000000@us.signin.invalid", confirmed: true })),
      false,
    );
  });

  it("legacy skip rows resolve to email (must re-supply a real address)", () => {
    const d = decideOnboardingTrack({
      hasRecord: true,
      usn: "1AY22CS001",
      email: null,
      emailSkipped: true,
    });
    assert.equal(d.step, "email");
  });

  it("no route creates internal identities for new accounts", async () => {
    const { readFileSync } = await import("node:fs");
    const pw = readFileSync(
      new URL("../../app/api/onboarding/password/route.ts", import.meta.url),
      "utf8",
    );
    const email = readFileSync(
      new URL("../../app/api/onboarding/email/route.ts", import.meta.url),
      "utf8",
    );
    assert.ok(!pw.includes("toInternalEmail"), "password route must not mint internal identities");
    assert.ok(!pw.includes("admin.updateUserById"), "password route must not admin-update Auth");
    // A skipped upsert would look like `email: null, email_skipped: true`.
    // (Clearing a legacy skip writes `email_skipped: false` — allowed.)
    assert.ok(!email.includes("email_skipped: true"), "email route must not record new skips");
  });

  it("write guard rejects internal recorded emails", () => {
    const verified = authUser({ email: "a@campus.edu", confirmed: true });
    assert.equal(
      decideVerifiedEmailForWrite({
        hasSession: true,
        recordedEmail: "u-00000000000040008000000000000000@us.signin.invalid",
        authUser: verified,
      }).ok,
      false,
    );
  });
});
