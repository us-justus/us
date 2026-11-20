// Unit tests for the staging pipeline guards. No credentials, no network.
//
//   node --test scripts/staging-config.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PRODUCTION_WORKER,
  STAGING_WORKER,
  parseMergeGroupRef,
  parseWranglerConfig,
  stripJsonComments,
  validateCandidateMetadata,
  validateWranglerEnvironments,
} from "./staging-config.mjs";

const realConfig = parseWranglerConfig(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("stripJsonComments keeps // inside strings and removes comments", () => {
  const input = `{
    // line comment
    "url": "https://example.com/a//b",
    /* block
       comment */
    "nested": { "value": "/* not a comment */" }
  }`;
  const parsed = JSON.parse(stripJsonComments(input));
  assert.equal(parsed.url, "https://example.com/a//b");
  assert.equal(parsed.nested.value, "/* not a comment */");
});

test("the repository wrangler.jsonc is safe for both Workers", () => {
  assert.deepEqual(validateWranglerEnvironments(realConfig), []);
  assert.equal(realConfig.name, PRODUCTION_WORKER);
  assert.equal(realConfig.env.staging.name, STAGING_WORKER);
});

test("a staging name that resolves production is rejected", () => {
  const config = clone(realConfig);
  config.env.staging.name = PRODUCTION_WORKER;
  assert.match(validateWranglerEnvironments(config).join("\n"), /env\.staging\.name must be "us-staging"/);
});

test("a staging self-reference that points at production is rejected", () => {
  const config = clone(realConfig);
  config.env.staging.services[0].service = PRODUCTION_WORKER;
  assert.match(validateWranglerEnvironments(config).join("\n"), /WORKER_SELF_REFERENCE must point at "us-staging"/);
});

test("a missing staging self-reference is rejected", () => {
  const config = clone(realConfig);
  config.env.staging.services = [];
  assert.match(validateWranglerEnvironments(config).join("\n"), /exactly one WORKER_SELF_REFERENCE/);
});

test("a top-level route is rejected because staging would inherit it", () => {
  const config = clone(realConfig);
  config.routes = [{ pattern: "us-justus.in", custom_domain: true }];
  assert.match(validateWranglerEnvironments(config).join("\n"), /top-level "routes" must not exist/);
});

test("a staging route is rejected", () => {
  const config = clone(realConfig);
  config.env.staging.routes = [{ pattern: "us-justus.in" }];
  assert.match(validateWranglerEnvironments(config).join("\n"), /env\.staging\.routes must not exist/);
});

test("removing env.staging is rejected", () => {
  const config = clone(realConfig);
  delete config.env;
  assert.match(validateWranglerEnvironments(config).join("\n"), /has no "env\.staging" block/);
});

test("changing the production name is rejected", () => {
  const config = clone(realConfig);
  config.name = "us-staging";
  assert.match(validateWranglerEnvironments(config).join("\n"), /top-level name must stay "us"/);
});

test("an inherited non-staging Supabase URL is rejected", () => {
  const config = clone(realConfig);
  config.vars = { NEXT_PUBLIC_SUPABASE_URL: "https://drhticapxbhpqosrkngy.supabase.co" };
  assert.match(validateWranglerEnvironments(config).join("\n"), /NEXT_PUBLIC_SUPABASE_URL/);

  const stagingVar = clone(realConfig);
  stagingVar.env.staging.vars = { NEXT_PUBLIC_SUPABASE_URL: "https://ietruyukgqwkmsyfvxxi.supabase.co" };
  assert.deepEqual(validateWranglerEnvironments(stagingVar), []);
});

const metadata = {
  schema: 1,
  repository: "us-justus/us",
  event: "pull_request",
  head_sha: "0123456789abcdef0123456789abcdef01234567",
  base_ref: "main",
  pr_number: 6,
  merge_group_ref: null,
  workflow: "staging-candidate",
  run_id: 111,
  run_attempt: 2,
  node: "24.22.1",
  pnpm: "11.21.0",
  next: "16.3.8",
  opennext: "1.20.8",
  built_at: new Date(0).toISOString(),
  worker_sha256: "a".repeat(64),
};

const expected = {
  repository: "us-justus/us",
  event: "pull_request",
  head_sha: metadata.head_sha,
  run_id: "111",
  run_attempt: "2",
  pr_number: "6",
};

test("valid candidate metadata passes", () => {
  assert.deepEqual(validateCandidateMetadata(metadata, expected), []);
});

test("candidate metadata is rejected when any cross-checked fact differs", () => {
  for (const [field, value] of [
    ["head_sha", "f".repeat(40)],
    ["repository", "evil/fork"],
    ["run_id", 222],
    ["run_attempt", 3],
    ["event", "push"],
  ]) {
    const errors = validateCandidateMetadata({ ...metadata, [field]: value }, expected);
    assert.ok(errors.length > 0, `${field} should be rejected`);
  }
});

test("candidate metadata must carry a real worker digest and timestamp", () => {
  assert.match(validateCandidateMetadata({ ...metadata, worker_sha256: "nope" }, expected).join("\n"), /worker_sha256/);
  assert.match(validateCandidateMetadata({ ...metadata, built_at: "not-a-date" }, expected).join("\n"), /built_at/);
  assert.match(validateCandidateMetadata({ ...metadata, schema: 9 }, expected).join("\n"), /schema/);
});

test("merge_group candidates must carry a merge queue ref", () => {
  const sha = "b".repeat(40);
  const mergeGroup = {
    ...metadata,
    event: "merge_group",
    head_sha: sha,
    pr_number: 6,
    merge_group_ref: `refs/heads/gh-readonly-queue/main/pr-6-${sha}`,
  };
  assert.deepEqual(validateCandidateMetadata(mergeGroup, { ...expected, event: "merge_group", head_sha: sha }), []);
  assert.match(validateCandidateMetadata({ ...mergeGroup, merge_group_ref: "refs/heads/main" }, expected).join("\n"), /merge_group_ref/);
});

test("merge group refs are parsed strictly", () => {
  const sha = "c".repeat(40);
  assert.deepEqual(parseMergeGroupRef(`refs/heads/gh-readonly-queue/main/pr-42-${sha}`), {
    base: "main",
    prNumber: 42,
    headSha: sha,
  });
  assert.equal(parseMergeGroupRef(`refs/heads/gh-readonly-queue/main/pr-42-${sha.slice(1)}`), null);
  assert.equal(parseMergeGroupRef(`refs/heads/gh-readonly-queue/main/pr-42-${sha}x`), null);
  assert.equal(parseMergeGroupRef("refs/heads/main"), null);
  assert.equal(parseMergeGroupRef(undefined), null);
});
