import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  claimFailureResponse,
  feedbackRecoveryView,
  providerFailurePlan,
} from "./reply-state.ts";

describe("feedback reply — claim failure mapping", () => {
  it("refuses resolved feedback before any send", () => {
    const r = claimFailureResponse("resolved");
    assert.equal(r.status, 409);
    assert.equal(r.reason, "resolved");
    assert.match(r.error, /resolved/i);
  });

  it("refuses an existing reply", () => {
    const r = claimFailureResponse("already_replied");
    assert.equal(r.status, 409);
    assert.equal(r.reason, "already_replied");
  });

  it("refuses a concurrent in-flight claim", () => {
    const r = claimFailureResponse("in_progress");
    assert.equal(r.status, 409);
    assert.equal(r.reason, "in_progress");
    assert.match(r.error, /already being processed/i);
  });

  it("fails closed on unknown claim failures", () => {
    const r = claimFailureResponse("something-else");
    assert.equal(r.status, 500);
    assert.equal(r.reason, "error");
  });
});

describe("feedback reply — provider failure settlement", () => {
  it("releases the claim for definite config failures", () => {
    const p = providerFailurePlan({
      kind: "config_error",
      detail: "missing",
    });
    assert.equal(p.settle, "RELEASED");
    assert.equal(p.status, 502);
    assert.equal(p.emailSent, false);
  });

  it("releases the claim for permanent provider rejections", () => {
    const p = providerFailurePlan({
      kind: "permanent_failure",
      detail: "http 422",
    });
    assert.equal(p.settle, "RELEASED");
  });

  it("releases the claim for a definite temporary (5xx) response", () => {
    const p = providerFailurePlan({
      kind: "temporary_failure",
      detail: "http 503",
      ambiguous: false,
    });
    assert.equal(p.settle, "RELEASED");
    assert.equal(p.unconfirmed, undefined);
  });

  it("keeps ambiguous timeouts unconfirmed to prevent a duplicate send", () => {
    const p = providerFailurePlan({
      kind: "temporary_failure",
      detail: "brevo request timed out",
      ambiguous: true,
    });
    assert.equal(p.settle, "UNCONFIRMED");
    assert.equal(p.unconfirmed, true);
    assert.equal(p.emailSent, false);
    assert.match(p.error, /could not be confirmed/i);
  });
});

describe("feedback reply — recovery state projection", () => {
  it("offers recovery only for ambiguous or unconfirmed attempts", () => {
    for (const state of ["SENDING", "UNCONFIRMED"]) {
      assert.deepEqual(feedbackRecoveryView(state), {
        state,
        recoverable: true,
      });
    }
  });

  it("hides recovery for terminal attempts and missing attempts", () => {
    assert.deepEqual(feedbackRecoveryView("SENT"), {
      state: "SENT",
      recoverable: false,
    });
    assert.deepEqual(feedbackRecoveryView("RELEASED"), {
      state: "RELEASED",
      recoverable: false,
    });
    assert.deepEqual(feedbackRecoveryView(null), {
      state: null,
      recoverable: false,
    });
    assert.deepEqual(feedbackRecoveryView(undefined), {
      state: null,
      recoverable: false,
    });
  });

  it("fails closed on unknown states instead of enabling recovery", () => {
    assert.equal(feedbackRecoveryView("CLAIM_TOKEN"), null);
    assert.equal(feedbackRecoveryView({ state: "UNCONFIRMED" }), null);
    assert.equal(feedbackRecoveryView(1), null);
  });
});
