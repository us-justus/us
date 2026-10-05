import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideOnboardingTrack, isEmailSkipAllowed } from "./track-decision.ts";

describe("decideOnboardingTrack — email required on every track", () => {
  it("fresh account with no record starts at USN", () => {
    assert.deepEqual(
      decideOnboardingTrack({ hasRecord: false, usn: null, email: null, emailSkipped: false }),
      { track: "fresh", step: "usn", emailRequired: false },
    );
  });

  it("USN present, email pending → normal track, email step (required)", () => {
    const d = decideOnboardingTrack({ hasRecord: true, usn: "1AY22CS001", email: null, emailSkipped: false });
    assert.equal(d.track, "normal");
    assert.equal(d.step, "email");
    assert.equal(d.emailRequired, true);
  });

  it("USN present + email recorded → normal track, beyond-email", () => {
    const d = decideOnboardingTrack({ hasRecord: true, usn: "1AY22CS001", email: "a@campus.edu", emailSkipped: false });
    assert.equal(d.track, "normal");
    assert.equal(d.step, "beyond-email");
    assert.equal(d.emailRequired, true);
  });

  it("USN present + legacy skipped → normal track, email step (skip never honored)", () => {
    const d = decideOnboardingTrack({ hasRecord: true, usn: "1AY22CS001", email: null, emailSkipped: true });
    assert.equal(d.track, "normal");
    assert.equal(d.step, "email");
    assert.equal(d.emailRequired, true);
  });
});

describe("decideOnboardingTrack — first-year email-first path", () => {
  it("marker row (no USN, no email yet) → email-first, email step (never USN)", () => {
    const d = decideOnboardingTrack({ hasRecord: true, usn: null, email: null, emailSkipped: false });
    assert.equal(d.track, "email-first");
    assert.equal(d.step, "email");
    assert.equal(d.emailRequired, true);
  });

  it("email supplied, no USN → email-first, beyond-email (email stage satisfied)", () => {
    const d = decideOnboardingTrack({ hasRecord: true, usn: null, email: "first@campus.edu", emailSkipped: false });
    assert.equal(d.track, "email-first");
    assert.equal(d.step, "beyond-email");
    assert.equal(d.emailRequired, true);
  });

  it("skip without USN is not a valid skip → back to email (email required)", () => {
    const d = decideOnboardingTrack({ hasRecord: true, usn: null, email: null, emailSkipped: true });
    assert.equal(d.track, "email-first");
    assert.equal(d.step, "email");
    assert.equal(d.emailRequired, true);
  });

  it("empty-string USN behaves as absent", () => {
    const d = decideOnboardingTrack({ hasRecord: true, usn: "", email: null, emailSkipped: false });
    assert.equal(d.track, "email-first");
    assert.equal(d.step, "email");
  });

  it("email-first never resolves to the USN step", () => {
    const cases = [
      { hasRecord: true, usn: null as string | null, email: null as string | null, emailSkipped: false },
      { hasRecord: true, usn: null, email: "a@campus.edu", emailSkipped: false },
      { hasRecord: true, usn: null, email: null, emailSkipped: true },
      { hasRecord: true, usn: "", email: "a@campus.edu", emailSkipped: false },
    ];
    for (const c of cases) {
      const d = decideOnboardingTrack(c);
      assert.notEqual(d.step, "usn", JSON.stringify(c));
    }
  });
});

describe("isEmailSkipAllowed — skip removed on every track", () => {
  it("never allows skip, even with a USN", () => {
    assert.equal(isEmailSkipAllowed({ usn: "1AY22CS001" }), false);
    assert.equal(isEmailSkipAllowed({ usn: null }), false);
    assert.equal(isEmailSkipAllowed({ usn: "" }), false);
    assert.equal(isEmailSkipAllowed(), false);
  });
});

describe("track-decision identity tripwire", () => {
  it("introduces no second-identity mechanism", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./track-decision.ts", import.meta.url), "utf8");
    for (const banned of ["signUp(", "signInWithPassword", ".updateUser(", "admin.", "service_role", "localStorage"]) {
      assert.ok(!src.includes(banned), `track decision must not contain ${banned}`);
    }
  });
});
