#!/usr/bin/env node
// Dependency-free guards shared by the staging workflows.
//
// Everything here is pure: the workflows do the GitHub/Cloudflare API calls and
// hand the results to these functions, so every rule below is unit-testable
// without credentials (see staging-config.test.mjs).
//
// Usage:
//   node scripts/staging-config.mjs wrangler [path/to/wrangler.jsonc]
//   node scripts/staging-config.mjs metadata <candidate.json>   # reads EXPECTED_* env
//   node scripts/staging-config.mjs merge-group-ref <ref>
//
// Exit 0 = every rule held. Exit 1 = a rule failed (GitHub ::error:: lines).
// Exit 2 = usage error. Nothing here ever prints a secret: only names/ids.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export const PRODUCTION_WORKER = "us";
export const STAGING_WORKER = "us-staging";
export const STAGING_SUPABASE_ORIGIN = "https://ietruyukgqwkmsyfvxxi.supabase.co";
export const PRODUCTION_SUPABASE_ORIGIN = "https://drhticapxbhpqosrkngy.supabase.co";
export const CANDIDATE_WORKFLOW = "staging-candidate";
export const CANDIDATE_METADATA_SCHEMA = 1;

/**
 * JSONC -> JSON. A small state machine instead of a regex so `//` inside a
 * string (URLs, globs) is not mistaken for a comment.
 */
export function stripJsonComments(text) {
  let out = "";
  let i = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        out += char;
      }
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (char === '"') inString = false;
      i += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      i += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    out += char;
    i += 1;
  }

  return out;
}

export function parseWranglerConfig(text) {
  return JSON.parse(stripJsonComments(text));
}

/**
 * The production Worker `us` is deployed by Cloudflare Workers Builds from the
 * top-level configuration. Staging is `--env staging`. These rules exist so a
 * staging command can never resolve the production Worker, and so production
 * behaviour cannot drift by accident.
 */
export function validateWranglerEnvironments(config) {
  const errors = [];

  if (!config || typeof config !== "object") {
    return ["wrangler.jsonc is not an object"];
  }
  if (config.name !== PRODUCTION_WORKER) {
    errors.push(`top-level name must stay "${PRODUCTION_WORKER}" (got ${JSON.stringify(config.name)})`);
  }
  if (config.main !== ".open-next/worker.js") {
    errors.push(`main must be ".open-next/worker.js" (got ${JSON.stringify(config.main)})`);
  }
  for (const key of ["route", "routes"]) {
    if (key in config) {
      errors.push(`top-level "${key}" must not exist: env.staging inherits routes and would take production traffic`);
    }
  }
  if (Array.isArray(config.services)) {
    for (const service of config.services) {
      if (service?.binding === "WORKER_SELF_REFERENCE" && service?.service !== PRODUCTION_WORKER) {
        errors.push(`top-level WORKER_SELF_REFERENCE must point at "${PRODUCTION_WORKER}" (got ${JSON.stringify(service?.service)})`);
      }
    }
  }

  // `vars` is inheritable. If production ever declares the Supabase URL as a
  // var, staging would silently inherit it and point at the production
  // database. NEXT_PUBLIC_* values are baked at build time today, so this can
  // only trip if someone adds them — which is exactly when it must trip.
  for (const [scope, vars] of [
    ["top-level", config.vars],
    ["env.staging", config.env?.staging?.vars],
  ]) {
    const url = vars?.NEXT_PUBLIC_SUPABASE_URL;
    if (url !== undefined && url !== STAGING_SUPABASE_ORIGIN) {
      errors.push(
        `${scope}.vars.NEXT_PUBLIC_SUPABASE_URL is ${JSON.stringify(url)}; staging would inherit a non-staging project (expected ${STAGING_SUPABASE_ORIGIN})`,
      );
    }
  }

  const staging = config.env?.staging;
  if (!staging || typeof staging !== "object") {
    errors.push('wrangler.jsonc has no "env.staging" block; staging deploy would fall back to production');
    return errors;
  }
  if (staging.name !== STAGING_WORKER) {
    errors.push(`env.staging.name must be "${STAGING_WORKER}" (got ${JSON.stringify(staging.name)})`);
  }
  for (const key of ["route", "routes"]) {
    if (key in staging) {
      errors.push(`env.staging.${key} must not exist: the staging Worker must not serve production routes`);
    }
  }

  // `services` is a non-inheritable key: env.staging must re-declare it, and
  // it must point at itself. Inheriting `us` would send OpenNext's internal
  // revalidation subrequests into production.
  const selfReferences = (Array.isArray(staging.services) ? staging.services : []).filter(
    (service) => service?.binding === "WORKER_SELF_REFERENCE",
  );
  if (selfReferences.length !== 1) {
    errors.push(`env.staging.services must declare exactly one WORKER_SELF_REFERENCE (found ${selfReferences.length})`);
  } else if (selfReferences[0].service !== STAGING_WORKER) {
    errors.push(`env.staging WORKER_SELF_REFERENCE must point at "${STAGING_WORKER}" (got ${JSON.stringify(selfReferences[0].service)})`);
  }

  return errors;
}

/**
 * The candidate artifact's metadata is written by untrusted PR code, so it is
 * only ever compared against facts the privileged workflow already knows
 * (workflow_run payload, GitHub API, artifact digest). It is never a source of
 * truth on its own.
 */
export function validateCandidateMetadata(metadata, expected) {
  const errors = [];
  if (!metadata || typeof metadata !== "object") {
    return ["candidate metadata is missing or not an object"];
  }

  if (metadata.schema !== CANDIDATE_METADATA_SCHEMA) {
    errors.push(`metadata.schema must be ${CANDIDATE_METADATA_SCHEMA} (got ${JSON.stringify(metadata.schema)})`);
  }

  const fields = ["repository", "event", "head_sha", "run_id", "run_attempt", "node", "pnpm", "next", "opennext"];
  for (const field of fields) {
    const actual = metadata[field];
    if (actual === undefined || actual === null || actual === "") {
      errors.push(`metadata.${field} is missing`);
      continue;
    }
    const want = expected[field];
    if (want === undefined || want === null || want === "") continue;
    if (String(actual) !== String(want)) {
      errors.push(`metadata.${field} is ${JSON.stringify(actual)}, expected ${JSON.stringify(want)}`);
    }
  }

  if (!/^[0-9a-f]{40}$/.test(String(metadata.head_sha ?? ""))) {
    errors.push("metadata.head_sha is not a 40-character lowercase commit SHA");
  }
  if (!/^[0-9a-f]{64}$/.test(String(metadata.worker_sha256 ?? ""))) {
    errors.push("metadata.worker_sha256 is not a sha256 hex digest");
  }
  if (Number.isNaN(Date.parse(String(metadata.built_at ?? "")))) {
    errors.push("metadata.built_at is not an ISO timestamp");
  }
  if (metadata.event === "pull_request" && !Number.isInteger(Number(metadata.pr_number))) {
    errors.push("metadata.pr_number is required for pull_request candidates");
  }
  if (metadata.event === "merge_group" && !parseMergeGroupRef(metadata.merge_group_ref)) {
    errors.push("metadata.merge_group_ref is not a gh-readonly-queue ref for pull_request");
  }

  return errors;
}

/**
 * Merge queue commits live on a temporary ref:
 *   refs/heads/gh-readonly-queue/main/pr-<number>-<merge-group-head-sha>
 */
export function parseMergeGroupRef(ref) {
  const match = /^refs\/heads\/gh-readonly-queue\/([^/]+)\/pr-(\d+)-([0-9a-f]{40})$/.exec(ref ?? "");
  if (!match) return null;
  return { base: match[1], prNumber: Number(match[2]), headSha: match[3] };
}

function readExpectedFromEnv() {
  const env = process.env;
  return {
    repository: env.EXPECTED_REPOSITORY,
    event: env.EXPECTED_EVENT,
    head_sha: env.EXPECTED_HEAD_SHA,
    run_id: env.EXPECTED_RUN_ID,
    run_attempt: env.EXPECTED_RUN_ATTEMPT,
    pr_number: env.EXPECTED_PR_NUMBER,
    merge_group_ref: env.EXPECTED_MERGE_GROUP_REF,
  };
}

function report(errors) {
  if (errors.length === 0) return 0;
  for (const error of errors) {
    console.error(`::error::${error}`);
  }
  return 1;
}

function main(argv) {
  const [command, ...args] = argv;

  if (command === "wrangler") {
    const path = args[0] ?? "wrangler.jsonc";
    let config;
    try {
      config = parseWranglerConfig(readFileSync(path, "utf8"));
    } catch (error) {
      console.error(`::error::cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    const errors = validateWranglerEnvironments(config);
    if (report(errors) !== 0) return 1;
    console.log(`OK: ${path} resolves "us" by default and "us-staging" with --env staging`);
    return 0;
  }

  if (command === "metadata") {
    const path = args[0] ?? "candidate.json";
    let metadata;
    try {
      metadata = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      console.error(`::error::cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    const errors = validateCandidateMetadata(metadata, readExpectedFromEnv());
    if (report(errors) !== 0) return 1;
    console.log(`OK: ${path} matches the expected run, commit and repository`);
    return 0;
  }

  if (command === "merge-group-ref") {
    const parsed = parseMergeGroupRef(args[0]);
    if (!parsed) {
      console.error(`::error::"${args[0] ?? ""}" is not a gh-readonly-queue pull_request ref`);
      return 1;
    }
    if (parsed.base !== "main") {
      console.error(`::error::merge group targets "${parsed.base}", expected main`);
      return 1;
    }
    console.log(`OK: merge group pr #${parsed.prNumber} at ${parsed.headSha}`);
    return 0;
  }

  // Names of the `vars` the staging Worker receives at deploy time (top-level
  // vars are inherited by env.staging). Used by the deploy preflight so a value
  // configured as a plain variable is not reported as a missing secret.
  if (command === "staging-vars") {
    const path = args[0] ?? "wrangler.jsonc";
    let config;
    try {
      config = parseWranglerConfig(readFileSync(path, "utf8"));
    } catch (error) {
      console.error(`::error::cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    const names = new Set([
      ...Object.keys(config.vars ?? {}),
      ...Object.keys(config.env?.staging?.vars ?? {}),
    ]);
    for (const name of [...names].sort()) console.log(name);
    return 0;
  }

  // Written by the UNPRIVILEGED candidate workflow. Every value is later
  // cross-checked against GitHub's own records; nothing here is trusted.
  if (command === "write-metadata") {
    const out = args[0] ?? "candidate.json";
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const mergeGroupRef = process.env.CANDIDATE_MERGE_GROUP_REF || null;
    const parsedMergeGroup = parseMergeGroupRef(mergeGroupRef);
    const event = process.env.CANDIDATE_EVENT || "";
    const prNumber =
      event === "merge_group" ? (parsedMergeGroup?.prNumber ?? null) : Number(process.env.CANDIDATE_PR_NUMBER || NaN) || null;

    const metadata = {
      schema: CANDIDATE_METADATA_SCHEMA,
      repository: process.env.GITHUB_REPOSITORY ?? null,
      event,
      head_sha: (process.env.CANDIDATE_HEAD_SHA ?? "").toLowerCase(),
      base_ref: process.env.CANDIDATE_BASE_REF || "main",
      pr_number: prNumber,
      merge_group_ref: mergeGroupRef,
      workflow: CANDIDATE_WORKFLOW,
      run_id: Number(process.env.GITHUB_RUN_ID || NaN) || null,
      run_attempt: Number(process.env.GITHUB_RUN_ATTEMPT || NaN) || null,
      node: process.version.replace(/^v/, ""),
      pnpm: process.env.CANDIDATE_PNPM_VERSION ?? null,
      next: pkg.dependencies?.next ?? null,
      opennext: pkg.dependencies?.["@opennextjs/cloudflare"] ?? null,
      built_at: new Date().toISOString(),
      worker_sha256: createHash("sha256").update(readFileSync(".open-next/worker.js")).digest("hex"),
    };

    const errors = validateCandidateMetadata(metadata, {});
    if (errors.length > 0) {
      for (const error of errors) console.error(`::error::${error}`);
      return 1;
    }

    writeFileSync(out, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(`OK: wrote ${out} for ${metadata.event} ${metadata.head_sha}`);
    return 0;
  }

  console.error("usage: staging-config.mjs <wrangler|metadata|write-metadata|merge-group-ref|staging-vars> [args]");
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
