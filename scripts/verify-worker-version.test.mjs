// Regression tests for the deployed Worker version guard.
//
//   node --test scripts/verify-worker-version.test.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  STAGING_WORKER,
  parseDeployLog,
  validateCommitSha,
  validateVersionId,
  validateWorkerName,
  validateWorkerVersion,
} from "./verify-worker-version.mjs";

const CLI = fileURLToPath(new URL("./verify-worker-version.mjs", import.meta.url));
const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const VERSION_ID = "18f97339-c287-4872-9bdd-e2135c07ec12";
const OTHER_VERSION_ID = "023e105f-2a42-4f8b-a1c1-73f6a2a30c0f";

function versionResponse(overrides = {}) {
  return {
    success: true,
    errors: [],
    messages: [],
    result: {
      id: VERSION_ID,
      number: 7,
      metadata: { created_on: "2026-11-19T00:00:00Z", source: "wrangler" },
      annotations: {
        "workers/tag": SHA,
        "workers/message": `staging candidate ${SHA}`,
      },
      ...overrides,
    },
  };
}

function deploymentsResponse(versions = [{ version_id: VERSION_ID, percentage: 100 }], overrides = {}) {
  return {
    success: true,
    errors: [],
    messages: [],
    result: {
      deployments: [
        {
          id: "182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e",
          created_on: "2026-11-19T00:01:00Z",
          source: "wrangler",
          strategy: "percentage",
          versions,
          annotations: { "workers/message": `staging candidate ${SHA}` },
        },
      ],
      ...overrides,
    },
  };
}

function validate({ worker = STAGING_WORKER, versionId = VERSION_ID, sha = SHA, version, deployments } = {}) {
  return validateWorkerVersion({
    worker,
    versionId,
    sha,
    version: version ?? versionResponse(),
    deployments: deployments ?? deploymentsResponse(),
  });
}

test("a matching version passes", () => {
  assert.deepEqual(validate(), []);
});

test("missing, unknown and malformed version IDs are rejected", () => {
  for (const value of [undefined, null, "", "  ", "unknown", "not-a-uuid", VERSION_ID.toUpperCase()]) {
    assert.ok(validateVersionId(value).length > 0, `${JSON.stringify(value)} should be rejected`);
  }
  assert.deepEqual(validateVersionId(VERSION_ID), []);

  assert.match(validate({ versionId: "" }).join("\n"), /version ID is missing/);
  assert.match(validate({ versionId: "unknown" }).join("\n"), /"unknown"/);
  assert.match(validate({ versionId: "version-1" }).join("\n"), /not a lowercase UUID/);
});

test("the production Worker and unknown Worker names are rejected", () => {
  assert.match(validateWorkerName("us").join("\n"), /production Worker/);
  assert.match(validateWorkerName("us-staging-2").join("\n"), /must be "us-staging"/);
  assert.match(validateWorkerName(undefined).join("\n"), /must be "us-staging"/);
  assert.deepEqual(validateWorkerName(STAGING_WORKER), []);

  assert.match(validate({ worker: "us" }).join("\n"), /production Worker/);
});

test("a malformed candidate SHA is rejected", () => {
  assert.ok(validateCommitSha("").length > 0);
  assert.ok(validateCommitSha(SHA.toUpperCase()).length > 0);
  assert.ok(validateCommitSha(SHA.slice(0, 39)).length > 0);
  assert.deepEqual(validateCommitSha(SHA), []);
});

test("version/commit mismatches are rejected", () => {
  assert.match(
    validate({ version: versionResponse({ annotations: { "workers/tag": OTHER_SHA } }) }).join("\n"),
    /is tagged .*expected candidate/,
  );
  assert.match(
    validate({ version: versionResponse({ annotations: {} }) }).join("\n"),
    /has no workers\/tag annotation/,
  );
  assert.match(
    validate({ version: versionResponse({ id: OTHER_VERSION_ID }) }).join("\n"),
    /version response is for/,
  );
  assert.match(
    validate({ sha: OTHER_SHA }).join("\n"),
    /is tagged .*expected candidate/,
  );
});

test("a failed Cloudflare API response fails closed", () => {
  assert.match(
    validate({ version: { success: false, result: {} } }).join("\n"),
    /Worker version response did not report success/,
  );
  assert.match(
    validate({ deployments: { success: false, result: {} } }).join("\n"),
    /Worker deployments response did not report success/,
  );
  assert.match(validate({ version: {} }).join("\n"), /response did not report success/);
});

test("the active deployment must serve the verified version at 100%", () => {
  assert.match(
    validate({ deployments: deploymentsResponse([]) }).join("\n"),
    /staging must serve exactly one/,
  );
  assert.match(
    validate({ deployments: deploymentsResponse([{ version_id: OTHER_VERSION_ID, percentage: 100 }]) }).join("\n"),
    /active deployment serves .*expected/,
  );
  assert.match(
    validate({ deployments: deploymentsResponse([{ version_id: VERSION_ID, percentage: 50 }]) }).join("\n"),
    /expected 100%/,
  );
  assert.match(
    validate({
      deployments: deploymentsResponse([
        { version_id: VERSION_ID, percentage: 50 },
        { version_id: OTHER_VERSION_ID, percentage: 50 },
      ]),
    }).join("\n"),
    /exactly one/,
  );
  assert.match(
    validate({ deployments: { success: true, result: { deployments: [] } } }).join("\n"),
    /no deployments/,
  );
});

test("deploy logs must contain exactly one real version ID", () => {
  const valid = parseDeployLog(`Uploaded us-staging\nCurrent Version ID: ${VERSION_ID}\nDeployed`);
  assert.deepEqual(valid, { versionId: VERSION_ID, errors: [] });

  assert.deepEqual(parseDeployLog(`Current Version ID: \x1b[32m${VERSION_ID}\x1b[0m`), {
    versionId: VERSION_ID,
    errors: [],
  });

  assert.match(parseDeployLog("").errors.join("\n"), /did not report a Current Version ID/);
  assert.match(parseDeployLog("Current Version ID: unknown").errors.join("\n"), /"unknown"/);
  assert.match(parseDeployLog("Current Version ID: version-1").errors.join("\n"), /not a lowercase UUID/);
  assert.match(
    parseDeployLog(`Current Version ID: ${VERSION_ID}\nCurrent Version ID: ${OTHER_VERSION_ID}`).errors.join("\n"),
    /multiple Worker version IDs/,
  );
  assert.deepEqual(
    parseDeployLog(`Current Version ID: ${VERSION_ID}\nCurrent Version ID: ${VERSION_ID}`).errors,
    [],
  );
});

test("the CLI reads the version ID from a deploy log and rejects unknown", () => {
  const dir = mkdtempSync(join(tmpdir(), "us-deploy-log-"));
  try {
    const good = join(dir, "good.log");
    writeFileSync(good, `Current Version ID: ${VERSION_ID}\n`);
    const ok = spawnSync(process.execPath, [CLI, "from-log", good], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout.trim(), VERSION_ID);

    const bad = join(dir, "bad.log");
    writeFileSync(bad, "Current Version ID: unknown\n");
    const rejected = spawnSync(process.execPath, [CLI, "from-log", bad], { encoding: "utf8" });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /::error::.*unknown/);
    assert.equal(rejected.stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI rejects unknown and malformed version IDs", () => {
  const ok = spawnSync(process.execPath, [CLI, "id", VERSION_ID], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /well formed/);

  for (const value of ["unknown", "not-a-uuid", ""]) {
    const result = spawnSync(process.execPath, [CLI, "id", value], { encoding: "utf8" });
    assert.equal(result.status, 1, `${JSON.stringify(value)} should fail`);
    assert.match(result.stderr, /::error::/);
  }
});
