// Regression tests for the manual staging CI gate. No credentials, no network.
//
//   node --test scripts/verify-ci-checks.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import { isCheckRunFromRun, verifyCiChecks } from "./verify-ci-checks.mjs";

const CURRENT_RUN_ID = "2002";
const OTHER_RUN_ID = "1001";

function detailsUrl(runId, jobId = "1") {
  return `https://github.com/us-justus/us/actions/runs/${runId}/job/${jobId}`;
}

function checkRun(name, status, conclusion, runId = OTHER_RUN_ID) {
  return {
    name,
    status,
    conclusion,
    details_url: detailsUrl(runId),
  };
}

function verify(checkRuns, { required = "validate", statuses = [] } = {}) {
  return verifyCiChecks({
    checkRuns,
    commitStatuses: statuses,
    requiredChecks: required,
    currentRunId: CURRENT_RUN_ID,
  });
}

test("the current manual deploy check is excluded while in_progress", () => {
  const checkRuns = [
    checkRun("deploy us-staging (manual)", "in_progress", null, CURRENT_RUN_ID),
    checkRun("validate", "completed", "success"),
  ];

  assert.deepEqual(verify(checkRuns), []);
});

test("a separate CI check that is still in_progress blocks deployment", () => {
  const checkRuns = [
    checkRun("deploy us-staging (manual)", "in_progress", null, CURRENT_RUN_ID),
    checkRun("validate", "in_progress", null),
  ];

  assert.match(verify(checkRuns).join("\n"), /check 'validate' is not finished \(status=in_progress\)/);
});

test("a separate check with the same name but a different run is not excluded", () => {
  const checkRuns = [
    checkRun("deploy us-staging (manual)", "in_progress", null, CURRENT_RUN_ID),
    // Run 20020 starts with the current run id; substring matching would
    // silently skip this pending check.
    checkRun("deploy us-staging (manual)", "in_progress", null, "20020"),
  ];

  assert.match(verify(checkRuns).join("\n"), /check 'deploy us-staging \(manual\)' is not finished/);
});

test("a failed or cancelled CI check blocks deployment", () => {
  for (const conclusion of ["failure", "cancelled", "timed_out", "stale"]) {
    const checkRuns = [checkRun("validate", "completed", conclusion)];
    assert.match(
      verify(checkRuns).join("\n"),
      new RegExp(`check 'validate' concluded '${conclusion}'`),
      `expected ${conclusion} to block`,
    );
  }
});

test("a pending or failed commit status blocks deployment", () => {
  const checkRuns = [checkRun("validate", "completed", "success")];
  const statuses = [
    { context: "staging/verified", state: "pending" },
    { context: "deploy-preview", state: "failure" },
  ];

  const errors = verify(checkRuns, { statuses }).join("\n");
  assert.match(errors, /commit status 'staging\/verified' is 'pending'/);
  assert.match(errors, /commit status 'deploy-preview' is 'failure'/);
});

test("a missing required check blocks deployment", () => {
  const checkRuns = [checkRun("validate", "completed", "success")];

  assert.match(
    verify(checkRuns, { required: "validate,staging/verified" }).join("\n"),
    /required check 'staging\/verified' did not run/,
  );
});

test("all completed successful CI checks allow verification to proceed", () => {
  const checkRuns = [
    checkRun("deploy us-staging (manual)", "in_progress", null, CURRENT_RUN_ID),
    checkRun("validate", "completed", "success"),
    checkRun("staging/verified", "completed", "neutral"),
    checkRun("docs only", "completed", "skipped"),
  ];

  assert.deepEqual(verify(checkRuns, { required: "validate,staging/verified" }), []);
});

test("a target commit with no CI results at all is rejected", () => {
  const checkRuns = [checkRun("deploy us-staging (manual)", "in_progress", null, CURRENT_RUN_ID)];

  assert.match(verify(checkRuns).join("\n"), /no CI results are attached to the target commit/);
});

test("only the exact actions run id is treated as the current run", () => {
  assert.equal(isCheckRunFromRun(checkRun("x", "in_progress", null, CURRENT_RUN_ID), CURRENT_RUN_ID), true);
  assert.equal(isCheckRunFromRun(checkRun("x", "in_progress", null, "20020"), CURRENT_RUN_ID), false);
  assert.equal(isCheckRunFromRun(checkRun("x", "in_progress", null, "12002"), CURRENT_RUN_ID), false);
  assert.equal(
    isCheckRunFromRun({ name: "x", details_url: `https://github.com/us-justus/us/actions/runs/${CURRENT_RUN_ID}` }, CURRENT_RUN_ID),
    true,
  );
  assert.equal(isCheckRunFromRun({ name: "x", details_url: "not a url" }, CURRENT_RUN_ID), false);
  assert.equal(isCheckRunFromRun({ name: "x" }, CURRENT_RUN_ID), false);
});
