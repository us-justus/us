// Fail when a Node test file exists but is not registered in `test:inside`.
//
// The test runner is an explicit file list (not a glob), so a new
// `*.test.ts` file can silently never run. This guard is intentionally
// dependency-free and runs in CI beside the tests it protects.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const command = pkg.scripts?.["test:inside"];

if (typeof command !== "string" || command.length === 0) {
  console.error("test-registration: package.json is missing scripts.test:inside");
  process.exit(1);
}

const registered = new Set(
  command
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.endsWith(".test.ts")),
);

const discovered = readdirSync(join(root, "src"), { recursive: true })
  .filter((entry) => typeof entry === "string" && entry.endsWith(".test.ts"))
  .map((entry) => `src/${entry.replaceAll("\\", "/")}`)
  .sort();

const missing = discovered.filter((file) => !registered.has(file));
const stale = [...registered].filter((file) => !discovered.includes(file));

console.log(
  `test-registration: ${discovered.length} test files discovered, ${registered.size} registered.`,
);

if (missing.length > 0 || stale.length > 0) {
  for (const file of missing) {
    console.error(`  missing from test:inside: ${file}`);
  }
  for (const file of stale) {
    console.error(`  registered but not found: ${file}`);
  }
  process.exit(1);
}

console.log("test-registration: all test files are registered.");
