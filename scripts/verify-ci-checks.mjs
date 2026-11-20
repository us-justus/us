#!/usr/bin/env node
// CI gate for the manual staging deployment.
//
// The workflow that calls this script is itself attached to the target commit
// as a check run. While the gate step runs, that check is `in_progress`, so a
// naive "every check must be completed" loop always fails on its own run. This
// module drops exactly the check runs belonging to the current GitHub Actions
// run and validates every remaining check run and commit status.
//
// Ownership is matched by `details_url` (`/actions/runs/<GITHUB_RUN_ID>/`), not
// by name: a separate run with the same job name must still block the deploy.
//
// Usage:
//   node scripts/verify-ci-checks.mjs verify \
//     --target-sha <40-hex> \
//     --current-run-id <GITHUB_RUN_ID> \
//     --check-runs <check-runs.json> \
//     --statuses <commit-statuses.json> \
//     --required "validate,staging/verified"
//
// Exit 0 = every other check is green and every required check ran.
// Exit 1 = a check is pending/failed or a required check is missing.
// Exit 2 = usage error. Never prints credentials or commit content.

import { readFileSync } from "node:fs";

const RUN_ID_PATTERN = /^\d+$/;
const ALLOWED_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const ALLOWED_STATUS_STATES = new Set(["success", "neutral", "skipped"]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when a check run belongs to the workflow run identified by `runId`.
 * GitHub exposes no run ID field on the check run, but Actions check runs point
 * `details_url` at `/actions/runs/<run_id>/job/<job_id>`. The path boundary keeps
 * run 123 from matching run 1234.
 */
export function isCheckRunFromRun(checkRun, runId) {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) return false;
  if (typeof checkRun?.details_url !== "string") return false;

  let pathname;
  try {
    pathname = new URL(checkRun.details_url).pathname;
  } catch {
    return false;
  }

  return new RegExp(`/actions/runs/${escapeRegExp(runId)}(?:/|$)`).test(pathname);
}

function splitRequiredChecks(requiredChecks) {
  return String(requiredChecks ?? "")
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/**
 * Validate every check run that does not belong to the current workflow run,
 * plus all commit statuses, plus the required check list.
 *
 * @returns {string[]} human-readable failures; empty means green.
 */
export function verifyCiChecks({ checkRuns, commitStatuses, requiredChecks, currentRunId }) {
  const errors = [];
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  const statuses = Array.isArray(commitStatuses) ? commitStatuses : [];
  const others = runs.filter((checkRun) => !isCheckRunFromRun(checkRun, currentRunId));

  if (others.length === 0 && statuses.length === 0) {
    errors.push(
      "no CI results are attached to the target commit; refusing to deploy an unverified commit",
    );
  }

  for (const checkRun of others) {
    const name = typeof checkRun?.name === "string" && checkRun.name !== "" ? checkRun.name : "(unnamed check)";
    if (checkRun?.status !== "completed") {
      errors.push(`check '${name}' is not finished (status=${checkRun?.status || "unknown"})`);
      continue;
    }
    if (!ALLOWED_CONCLUSIONS.has(checkRun?.conclusion)) {
      errors.push(`check '${name}' concluded '${checkRun?.conclusion || "none"}'`);
    }
  }

  for (const status of statuses) {
    const context = typeof status?.context === "string" && status.context !== "" ? status.context : "(unnamed status)";
    if (!ALLOWED_STATUS_STATES.has(status?.state)) {
      errors.push(`commit status '${context}' is '${status?.state || "unknown"}'`);
    }
  }

  const names = new Set(others.map((checkRun) => checkRun?.name).filter((name) => typeof name === "string"));
  for (const required of splitRequiredChecks(requiredChecks)) {
    if (!names.has(required)) {
      errors.push(`required check '${required}' did not run on the target commit`);
    }
  }

  return errors;
}

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    flags[arg.slice(2)] = value;
    index += 1;
  }
  return flags;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${label} from ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function main(argv) {
  const [command, ...args] = argv;
  if (command !== "verify") {
    console.error("usage: verify-ci-checks.mjs verify --target-sha <sha> --current-run-id <id> --check-runs <json> --statuses <json> --required <names>");
    return 2;
  }

  let flags;
  try {
    flags = parseFlags(args);
  } catch (error) {
    console.error(`::error::${error.message}`);
    return 2;
  }

  for (const required of ["target-sha", "current-run-id", "check-runs", "statuses"]) {
    if (!flags[required]) {
      console.error(`::error::--${required} is required`);
      return 2;
    }
  }

  const currentRunId = flags["current-run-id"];
  if (!RUN_ID_PATTERN.test(currentRunId)) {
    console.error(`::error::--current-run-id must be the numeric GITHUB_RUN_ID (got ${JSON.stringify(currentRunId)})`);
    return 2;
  }

  let checkRuns;
  let commitStatuses;
  try {
    checkRuns = readJson(flags["check-runs"], "check runs");
    commitStatuses = readJson(flags.statuses, "commit statuses");
  } catch (error) {
    console.error(`::error::${error.message}`);
    return 1;
  }

  if (!Array.isArray(checkRuns) || !Array.isArray(commitStatuses)) {
    console.error("::error::check runs and commit statuses must both be JSON arrays");
    return 1;
  }

  const own = checkRuns.filter((checkRun) => isCheckRunFromRun(checkRun, currentRunId));
  for (const checkRun of own) {
    console.log(`ignoring check run from this workflow run: ${checkRun.name} (run ${currentRunId})`);
  }

  const errors = verifyCiChecks({
    checkRuns,
    commitStatuses,
    requiredChecks: flags.required ?? "validate",
    currentRunId,
  });

  if (errors.length > 0) {
    for (const error of errors) console.error(`::error::${error}`);
    return 1;
  }

  console.log(
    `OK: ${checkRuns.length - own.length} check run(s) and ${commitStatuses.length} commit status(es) verified for ${flags["target-sha"]}`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
