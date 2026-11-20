#!/usr/bin/env node
// Independent verification of the deployed staging Worker version.
//
// `wrangler deploy` prints the version it uploaded, but that line is only a
// hint: this module re-reads the version and the active deployment from the
// Cloudflare API and checks that
//
//   - the reported ID is a real Worker version UUID (never "unknown"),
//   - the version carries `workers/tag` equal to the candidate commit SHA,
//   - the latest deployment serves exactly that version at 100% of traffic.
//
// The workflows call this twice: once immediately after deploy, and again after
// the smoke test, so `staging/verified` is only published while the version
// that passed smoke is still the active one.
//
// Usage:
//   node scripts/verify-worker-version.mjs id <version-id>
//   node scripts/verify-worker-version.mjs from-log <deploy.log>
//   node scripts/verify-worker-version.mjs verify --worker us-staging \
//     --version-id <uuid> --sha <40-hex> \
//     --version <version.json> --deployments <deployments.json>
//
// Exit 0 = every rule held. Exit 1 = a rule failed. Exit 2 = usage error.
// Never prints a token: only worker names, ids and commit SHAs.

import { readFileSync } from "node:fs";

export const STAGING_WORKER = "us-staging";
export const PRODUCTION_WORKER = "us";

const VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export function validateVersionId(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return ["Worker version ID is missing"];
  }
  if (value === "unknown") {
    return ['Worker version ID is "unknown"; a real Cloudflare version ID is required'];
  }
  if (!VERSION_ID_PATTERN.test(value)) {
    return [`Worker version ID ${JSON.stringify(value)} is not a lowercase UUID`];
  }
  return [];
}

export function validateWorkerName(value) {
  if (value === PRODUCTION_WORKER) {
    return [`refusing to verify the production Worker "${PRODUCTION_WORKER}"`];
  }
  if (value !== STAGING_WORKER) {
    return [`worker must be "${STAGING_WORKER}" (got ${JSON.stringify(value)})`];
  }
  return [];
}

export function validateCommitSha(value) {
  if (typeof value !== "string" || !COMMIT_SHA_PATTERN.test(value)) {
    return [`candidate SHA ${JSON.stringify(value)} is not a 40-character lowercase commit SHA`];
  }
  return [];
}

/**
 * Extract the version ID from `wrangler deploy` output. Fails closed on a
 * missing line, on `unknown`, on a malformed ID and on conflicting IDs.
 *
 * @param {string} text deploy log
 * @returns {{ versionId?: string, errors: string[] }}
 */
export function parseDeployLog(text) {
  const clean = String(text ?? "").replace(ANSI_PATTERN, "");
  const tokens = [...clean.matchAll(/Current Version ID:\s*(\S+)/g)].map((match) => match[1]);

  if (tokens.length === 0) {
    return { errors: ["wrangler deploy did not report a Current Version ID"] };
  }

  const errors = [];
  for (const token of tokens) errors.push(...validateVersionId(token));

  const unique = [...new Set(tokens)];
  if (unique.length > 1) {
    errors.push(`wrangler deploy reported multiple Worker version IDs: ${unique.join(", ")}`);
  }
  if (errors.length > 0) return { errors };

  return { versionId: unique[0], errors: [] };
}

function readApiResult(response, label, errors) {
  if (!response || typeof response !== "object") {
    errors.push(`${label} response is not a JSON object`);
    return null;
  }
  if (response.success !== true) {
    errors.push(`${label} response did not report success`);
    return null;
  }
  if (!response.result || typeof response.result !== "object") {
    errors.push(`${label} response has no result`);
    return null;
  }
  return response.result;
}

/**
 * @param {object} input
 * @param {string} input.worker        worker name the API response came from
 * @param {string} input.versionId     version ID reported by `wrangler deploy`
 * @param {string} input.sha           candidate commit SHA
 * @param {object} input.version       GET /versions/{id} response
 * @param {object} input.deployments   GET /deployments response
 * @returns {string[]} errors (empty when everything matches)
 */
export function validateWorkerVersion({ worker, versionId, sha, version, deployments }) {
  const errors = [
    ...validateWorkerName(worker),
    ...validateVersionId(versionId),
    ...validateCommitSha(sha),
  ];

  const versionResult = readApiResult(version, "Worker version", errors);
  if (versionResult) {
    if (versionResult.id !== versionId) {
      errors.push(
        `Worker version response is for ${JSON.stringify(versionResult.id)}, expected ${JSON.stringify(versionId)}`,
      );
    }
    const tag = versionResult.annotations?.["workers/tag"];
    if (typeof tag !== "string" || tag === "") {
      errors.push(`Worker version ${versionId} has no workers/tag annotation; cannot bind it to a commit`);
    } else if (tag !== sha) {
      errors.push(`Worker version ${versionId} is tagged ${JSON.stringify(tag)}, expected candidate ${sha}`);
    }
  }

  const deploymentResult = readApiResult(deployments, "Worker deployments", errors);
  if (deploymentResult) {
    const list = deploymentResult.deployments;
    if (!Array.isArray(list) || list.length === 0) {
      errors.push("Cloudflare returned no deployments for the staging Worker");
    } else {
      // The API documents the first deployment as the latest active one.
      const active = list[0];
      if (!active || typeof active !== "object") {
        errors.push("the latest deployment is not an object");
      } else {
        const versions = active.versions;
        if (!Array.isArray(versions) || versions.length !== 1) {
          errors.push(
            `the active deployment serves ${Array.isArray(versions) ? versions.length : "no"} versions; staging must serve exactly one`,
          );
        } else {
          const [served] = versions;
          if (served?.version_id !== versionId) {
            errors.push(
              `the active deployment serves ${JSON.stringify(served?.version_id)}, expected ${JSON.stringify(versionId)}`,
            );
          }
          if (served?.percentage !== 100) {
            errors.push(
              `the active deployment serves ${versionId} at ${JSON.stringify(served?.percentage)}%, expected 100%`,
            );
          }
        }
      }
    }
  }

  return errors;
}

function report(errors) {
  if (errors.length === 0) return 0;
  for (const error of errors) console.error(`::error::${error}`);
  return 1;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${label} from ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
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

function main(argv) {
  const [command, ...args] = argv;

  if (command === "id") {
    if (args.length !== 1) {
      console.error("usage: verify-worker-version.mjs id <version-id>");
      return 2;
    }
    const errors = validateVersionId(args[0]);
    if (report(errors) !== 0) return 1;
    console.log(`OK: Worker version ID ${args[0]} is well formed`);
    return 0;
  }

  if (command === "from-log") {
    if (args.length !== 1) {
      console.error("usage: verify-worker-version.mjs from-log <deploy.log>");
      return 2;
    }
    let text;
    try {
      text = readFileSync(args[0], "utf8");
    } catch (error) {
      console.error(`::error::cannot read ${args[0]}: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    const { versionId, errors } = parseDeployLog(text);
    if (report(errors) !== 0) return 1;
    console.log(versionId);
    return 0;
  }

  if (command === "verify") {
    let flags;
    try {
      flags = parseFlags(args);
    } catch (error) {
      console.error(`::error::${error.message}`);
      return 2;
    }

    const { worker, "version-id": versionId, sha, version: versionPath, deployments: deploymentsPath } = flags;
    for (const required of ["worker", "version-id", "sha", "version", "deployments"]) {
      if (!flags[required]) {
        console.error(`::error::--${required} is required`);
        return 2;
      }
    }

    let version;
    let deployments;
    try {
      version = readJson(versionPath, "Worker version");
      deployments = readJson(deploymentsPath, "Worker deployments");
    } catch (error) {
      console.error(`::error::${error.message}`);
      return 1;
    }

    const errors = validateWorkerVersion({ worker, versionId, sha, version, deployments });
    if (report(errors) !== 0) return 1;
    console.log(`OK: ${worker} version ${versionId} is active at 100% and tagged ${sha}`);
    return 0;
  }

  console.error("usage: verify-worker-version.mjs <id|from-log|verify> [args]");
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
