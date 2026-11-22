#!/usr/bin/env node
// Workflow pin guard: fails when any GitHub Actions workflow references an
// action that is not pinned to a full commit SHA.
//
// Usage:
//   node scripts/check-workflow-pins.mjs
//
// Exit 0 = every remote action in every workflow file is pinned to a full
//          40-character commit SHA; local (`./...`) actions are allowed.
// Exit 1 = at least one unpinned remote action reference was found.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const WORKFLOW_DIR = ".github/workflows";
const SHA_PATTERN = /^[0-9a-f]{40}$/;

function listFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listFiles(full));
    } else if (entry.endsWith(".yml") || entry.endsWith(".yaml")) {
      files.push(full);
    }
  }
  return files;
}

function checkFile(file) {
  const violations = [];
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    const match = line.match(/^\s*uses:\s*(.+?)\s*$/);
    if (!match) return;
    const value = match[1].split("#")[0].trim();
    if (value.startsWith("./")) return;
    const at = value.indexOf("@");
    if (at === -1) {
      violations.push(`${file}:${index + 1}: '${value}' has no action ref`);
      return;
    }
    const ref = value.slice(at + 1);
    if (!SHA_PATTERN.test(ref)) {
      violations.push(`${file}:${index + 1}: '${value}' is not pinned to a full commit SHA`);
    }
  });
  return violations;
}

function main() {
  const files = listFiles(WORKFLOW_DIR).sort();
  const violations = [];
  for (const file of files) {
    violations.push(...checkFile(file));
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`::error::${violation}`);
    }
    return 1;
  }

  console.log(`OK: ${files.length} workflow file(s) checked; all remote actions are SHA-pinned.`);
  return 0;
}

process.exit(main());
