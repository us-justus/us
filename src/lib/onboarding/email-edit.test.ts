import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildEmailEditHref,
  canShowEmailEdit,
  decideEmailReplacement,
  isDuplicateEmailLinkError,
  isEmailEditIntent,
  mapEmailLinkError,
} from "./email-edit.ts";
import { decideOnboardingTrack } from "./track-decision.ts";

describe("1. duplicate email remains rejected", () => {
  it("matches Supabase duplicate/already wordings", () => {
    for (const message of [
      "duplicate key value violates unique constraint",
      "Email address already registered",
      "This email is already in use",
      "User already registered",
      "email address is already associated with another account",
      "A user with this email address has already been registered",
      "Email already exists",
    ]) {
      assert.equal(isDuplicateEmailLinkError({ message }), true, message);
    }
  });

  it("does not match unrelated errors", () => {
    assert.equal(isDuplicateEmailLinkError({ message: "Network error" }), false);
    assert.equal(isDuplicateEmailLinkError({ message: "" }), false);
    assert.equal(isDuplicateEmailLinkError(null), false);
    assert.equal(isDuplicateEmailLinkError(undefined), false);
  });

  it("keeps the rejection message clear and actionable", () => {
    assert.equal(mapEmailLinkError(), "This email can't be used right now. Try another.");
  });

  it("password form still surfaces the clear rejection (no silent pass)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../app/onboarding/password/form.tsx", import.meta.url), "utf8");
    assert.ok(src.includes("mapEmailLinkError"), "password form must use the clear link-error message");
    assert.ok(
      src.includes("This email can't be used right now. Try another.") || src.includes("mapEmailLinkError"),
      "duplicate rejection copy must remain",
    );
  });
});

describe("2. recovery action can return to email entry", () => {
  it("builds the narrowly scoped edit intent", () => {
    assert.equal(buildEmailEditHref(), "/onboarding/email?edit=1");
  });

  it("recognises ?edit=1 from URLSearchParams and server records", () => {
    assert.equal(isEmailEditIntent(new URLSearchParams("edit=1")), true);
    assert.equal(isEmailEditIntent(new URLSearchParams("")), false);
    assert.equal(isEmailEditIntent(new URLSearchParams("edit=0")), false);
    assert.equal(isEmailEditIntent({ edit: "1" }), true);
    assert.equal(isEmailEditIntent({}), false);
    assert.equal(isEmailEditIntent(null), false);
    assert.equal(isEmailEditIntent(undefined), false);
  });

  it("password step renders the recovery action in unverified phases", () => {
    assert.equal(canShowEmailEdit({ step: "password", accountKind: "anonymous" }), true);
    assert.equal(canShowEmailEdit({ step: "password", accountKind: "permanent-unverified" }), true);
  });

  it("password form links back to the editable email entry", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../app/onboarding/password/form.tsx", import.meta.url), "utf8");
    assert.ok(src.includes("use a different email"), "password step must offer the recovery action");
    assert.ok(src.includes("buildEmailEditHref"), "recovery must use the explicit edit intent");
  });

  it("email entry stays editable in edit mode (no immutable rejection)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../app/onboarding/email/form.tsx", import.meta.url), "utf8");
    assert.ok(src.includes("isEmailEditIntent"), "email form must honour the edit intent");
    assert.ok(src.includes("enter a different address"), "edit mode must invite a replacement");
    // The field is a controlled input bound to state — never a frozen value.
    assert.ok(src.includes("value={email}"), "email field must remain editable");
    assert.ok(!src.includes("disabled") || src.includes("disabled={busy"), "email input must not be frozen");
  });
});

describe("3. email can actually be replaced", () => {
  it("a different address replaces the stored one", () => {
    assert.deepEqual(
      decideEmailReplacement({ storedEmail: "taken@campus.edu", submittedEmail: "fresh@campus.edu" }),
      { action: "replace" },
    );
  });

  it("resubmitting the identical address is a no-op (never a bypass)", () => {
    assert.deepEqual(
      decideEmailReplacement({ storedEmail: "a@campus.edu", submittedEmail: "A@campus.edu" }),
      { action: "no-op-same" },
    );
  });

  it("email API upserts onto the existing row (replace, never a second row)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../app/api/onboarding/email/route.ts", import.meta.url), "utf8");
    assert.ok(src.includes("upsert({ user_id: user.id, email: val"), "email submit must upsert the same row");
  });
});

describe("4. replacement still uses the same UID", () => {
  it("email route derives the UID exclusively from the session (never client input)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../app/api/onboarding/email/route.ts", import.meta.url), "utf8");
    assert.ok(src.includes("auth.getUser()"), "UID must come from the authenticated session");
    for (const banned of ["body?.user_id", "body.user_id", "body?.userId", "signUp("]) {
      assert.ok(!src.includes(banned), `email route must not contain ${banned}`);
    }
  });

  it("recovery introduces no second-identity mechanism", async () => {
    const { readFileSync } = await import("node:fs");
    const helper = readFileSync(new URL("./email-edit.ts", import.meta.url), "utf8");
    for (const banned of ["signUp(", "signInWithPassword", ".updateUser(", "admin.", "service_role", "localStorage"]) {
      assert.ok(!helper.includes(banned), `email-edit helper must not contain ${banned}`);
    }
    const pw = readFileSync(new URL("../../app/onboarding/password/form.tsx", import.meta.url), "utf8");
    assert.ok(!pw.includes("signUp("), "password recovery must never signUp");
  });
});

describe("5. normal email-first flow remains unchanged", () => {
  it("marker row still enters the email-first track (email required)", () => {
    const d = decideOnboardingTrack({ hasRecord: true, usn: null, email: null, emailSkipped: false });
    assert.deepEqual(d, { track: "email-first", step: "email", emailRequired: true });
  });

  it("recorded email still satisfies the email stage (shared tail)", () => {
    const d = decideOnboardingTrack({ hasRecord: true, usn: null, email: "first@campus.edu", emailSkipped: false });
    assert.equal(d.track, "email-first");
    assert.equal(d.step, "beyond-email");
  });
});

describe("6. normal USN flow requires email (no skip)", () => {
  it("fresh accounts still start at USN", () => {
    assert.deepEqual(
      decideOnboardingTrack({ hasRecord: false, usn: null, email: null, emailSkipped: false }),
      { track: "fresh", step: "usn", emailRequired: false },
    );
  });

  it("USN-anchored accounts without email owe the email step (skip never honored)", () => {
    const d = decideOnboardingTrack({ hasRecord: true, usn: "1AY22CS001", email: null, emailSkipped: true });
    assert.equal(d.track, "normal");
    assert.equal(d.step, "email");
    assert.equal(d.emailRequired, true);
  });

  it("USN-anchored accounts with email proceed beyond-email", () => {
    const d = decideOnboardingTrack({ hasRecord: true, usn: "1AY22CS001", email: "a@campus.edu", emailSkipped: false });
    assert.equal(d.track, "normal");
    assert.equal(d.step, "beyond-email");
    assert.equal(d.emailRequired, true);
  });
});

describe("7. recovery cannot bypass verification/password requirements", () => {
  it("never shows once verified or off the password step", () => {
    assert.equal(canShowEmailEdit({ step: "password", accountKind: "permanent-verified" }), false);
    assert.equal(canShowEmailEdit({ step: "password", accountKind: null }), false);
    for (const step of ["usn", "email", "profile", "photos", "complete"]) {
      assert.equal(canShowEmailEdit({ step, accountKind: "anonymous" }), false, step);
      assert.equal(canShowEmailEdit({ step, accountKind: "permanent-unverified" }), false, step);
    }
  });

  it("email page guard stays complete-only (no step bypass, no skip bypass)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../app/onboarding/email/page.tsx", import.meta.url), "utf8");
    assert.ok(src.includes('if (step === "complete") redirect("/home")'), "complete guard must target authenticated home");
    assert.ok(!src.includes('redirect(stepPath'), "email page must not bounce recovery to another step");
  });

  it("email form renders no skip affordance for any account", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../app/onboarding/email/form.tsx", import.meta.url), "utf8");
    assert.ok(!src.includes("skip for now"), "skip copy must be gone");
    assert.ok(!src.includes("emailSkipped"), "skip state must be gone");
    assert.ok(!src.includes("skipping"), "skip action must be gone");
    assert.ok(src.includes("Required"), "email-required copy must remain");
  });
});
