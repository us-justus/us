// Post-deploy live smoke gate for production.
//
// Usage:
//   node scripts/smoke-prod.mjs [base-url]
//   pnpm release:smoke
//
// What it does: read-only GETs against the LIVE deployment and asserts the
// critical routes serve correctly. Exit 0 = release healthy, exit 1 = hard
// failure (do NOT treat the release as healthy; see the rollback runbook in
// spec.md §12.1).
//
// What it never does (by design, see spec.md §12.1):
// - no admin credentials, no ADMIN_SECRET_KEY, no secrets of any kind
// - no authenticated admin actions, no writes (GET only)
// - no log output containing secrets (only route, status, latency, content-type)
//
// Notes:
// - A browser-like User-Agent is required: production edge behavior can
//   reject bare non-browser clients with 403s that look like app failures.
// - Failed passes are retried with backoff for ~2-3 minutes to absorb cold
//   start / propagation delay before declaring FAIL.
// - Node standard library only (no dependencies, so the gate itself can
//   never drift with installs).

import { execFileSync } from "node:child_process";

const BASE_URL = (process.argv[2] || process.env.SMOKE_BASE_URL || "https://us-justus.in").replace(/\/+$/, "");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 25000;

// Pass start offsets (ms): first pass immediately, then retries with backoff.
// Total budget ≈ 2.5 minutes plus request time.
const PASS_DELAYS_MS = [0, 20000, 30000, 30000, 30000, 30000];

const CHECKS = [
  {
    name: "GET /",
    path: "/",
    expectStatus: 200,
    // Stable landing marker from the document title (metadata, not copy).
    expectBodyContains: ["<title>us — just us."],
  },
  {
    name: "GET /login",
    path: "/login",
    expectStatus: 200,
  },
  {
    name: "GET /inside (admin login screen, unauthenticated)",
    path: "/inside",
    expectStatus: 200,
    // Stable admin-login UI markers: the "inside." heading and the
    // identifier field label. A 500 here is the Oct 2026 incident signature
    // and MUST fail the release.
    expectBodyContains: ["inside.", "identifier"],
  },
  {
    name: "GET /api/account/state (signed-out shape)",
    path: "/api/account/state",
    expectStatus: 200,
    expectBodyContains: ['"signedIn":false'],
  },
  {
    name: "GET /api/inside/health (anonymous must be denied)",
    path: "/api/inside/health",
    // 403 proves the admin gate loads and denies anonymous callers, exactly
    // as designed. NOTE: this does NOT prove the /inside page renders —
    // only the page check above does that.
    expectStatus: 403,
    expectBodyContains: ['"error":"Not available."'],
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function get(url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy(new Error(`request timeout after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);
    const req = fetch(url, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
      redirect: "manual",
    }).then(
      async (res) => {
        clearTimeout(timer);
        const body = await res.text().catch(() => "");
        resolve({
          status: res.status,
          contentType: res.headers.get("content-type") ?? "(none)",
          size: body.length,
          body,
        });
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
    void req;
  });
}

async function runCheck(check) {
  const started = Date.now();
  const url = `${BASE_URL}${check.path}`;
  try {
    const res = await get(url);
    const latency = Date.now() - started;
    const failures = [];
    if (res.status !== check.expectStatus) {
      failures.push(`expected status ${check.expectStatus}, got ${res.status}`);
    }
    // Any 5xx is a hard failure even if the expected status were somehow 5xx
    // (it never is) — server errors must never pass a release gate.
    if (res.status >= 500) {
      failures.push(`server error status ${res.status}`);
    }
    for (const marker of check.expectBodyContains ?? []) {
      if (!res.body.includes(marker)) {
        failures.push(`body missing marker ${JSON.stringify(marker)}`);
      }
    }
    return {
      name: check.name,
      ok: failures.length === 0,
      status: res.status,
      latency,
      contentType: res.contentType,
      size: res.size,
      failures,
    };
  } catch (err) {
    return {
      name: check.name,
      ok: false,
      status: null,
      latency: Date.now() - started,
      contentType: null,
      size: null,
      failures: [`request failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

function localHead() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "(unknown — not a git checkout)";
  }
}

const head = localHead();
console.log(`smoke-prod: base=${BASE_URL} localHEAD=${head}`);
console.log("smoke-prod: read-only GETs only; no credentials, no secrets, no writes.");

let passResults = [];
for (let i = 0; i < PASS_DELAYS_MS.length; i += 1) {
  if (PASS_DELAYS_MS[i] > 0) {
    console.log(`smoke-prod: pass ${i + 1}/${PASS_DELAYS_MS.length} after waiting ${PASS_DELAYS_MS[i] / 1000}s…`);
    await sleep(PASS_DELAYS_MS[i]);
  } else {
    console.log(`smoke-prod: pass ${i + 1}/${PASS_DELAYS_MS.length}…`);
  }
  passResults = [];
  for (const check of CHECKS) {
    const r = await runCheck(check);
    passResults.push(r);
    const status = r.status === null ? "ERR" : r.status;
    console.log(
      `  [${r.ok ? "ok" : "FAIL"}] ${r.name} -> ${status} ${r.latency}ms ${r.contentType ?? ""} ${r.size ?? ""}`.trimEnd(),
    );
    for (const f of r.failures) console.log(`         - ${f}`);
  }
  if (passResults.every((r) => r.ok)) {
    console.log("smoke-prod: PASS — live release healthy.");
    process.exit(0);
  }
  if (i < PASS_DELAYS_MS.length - 1) {
    console.log("smoke-prod: not all checks passed, retrying (cold start / propagation)…");
  }
}

console.log("smoke-prod: FAIL — live release is not healthy.");
console.log("smoke-prod: do NOT treat this deployment as a release.");
console.log("smoke-prod: record the live version ID and follow the rollback runbook (spec.md §12.1).");
console.log(`smoke-prod: local HEAD was ${head} — confirm what is actually live before rolling back.`);
process.exit(1);
