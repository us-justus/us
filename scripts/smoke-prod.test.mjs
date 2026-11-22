// Unit tests for production smoke URL validation and timeout handling.
//
//   node --test scripts/smoke-prod.test.mjs
//
// No network: fetch is mocked.

import assert from "node:assert/strict";
import test from "node:test";

import { get, validateBaseUrl } from "./smoke-prod.mjs";

test("validateBaseUrl accepts HTTPS targets", () => {
  assert.equal(validateBaseUrl("https://us-justus.in"), "https://us-justus.in");
  assert.equal(validateBaseUrl("https://us-justus.in/"), "https://us-justus.in");
  assert.equal(validateBaseUrl("https://example.com/foo/"), "https://example.com/foo");
});

test("validateBaseUrl allows HTTP only for local targets", () => {
  assert.equal(validateBaseUrl("http://localhost:3000"), "http://localhost:3000");
  assert.equal(validateBaseUrl("http://127.0.0.1:8787/"), "http://127.0.0.1:8787");
});

test("validateBaseUrl rejects malformed URLs", () => {
  assert.throws(() => validateBaseUrl("not a url"), /invalid base URL/);
  assert.throws(() => validateBaseUrl(""), /base URL is required/);
});

test("validateBaseUrl rejects unsafe schemes", () => {
  assert.throws(() => validateBaseUrl("ftp://example.com"), /unsupported URL scheme/);
  assert.throws(() => validateBaseUrl("file:///etc/passwd"), /unsupported URL scheme/);
  assert.throws(() => validateBaseUrl("javascript:alert(1)"), /unsupported URL scheme/);
});

test("validateBaseUrl rejects HTTP for external targets", () => {
  assert.throws(() => validateBaseUrl("http://example.com"), /only HTTPS is allowed/);
});

test("validateBaseUrl rejects credentials", () => {
  assert.throws(() => validateBaseUrl("https://user:pass@example.com"), /must not include credentials/);
});

test("get resolves with status, body, and content type", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    status: 200,
    headers: { get: (name) => (name === "content-type" ? "text/plain" : null) },
    text: async () => "hello",
  });
  try {
    const res = await get("https://example.com", { timeoutMs: 1000 });
    assert.equal(res.status, 200);
    assert.equal(res.body, "hello");
    assert.equal(res.size, 5);
    assert.equal(res.contentType, "text/plain");
  } finally {
    global.fetch = originalFetch;
  }
});

test("get rejects when body read stalls past timeout", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, opts) => ({
    status: 200,
    headers: { get: () => "text/plain" },
    text: () =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
  });
  try {
    const start = Date.now();
    await assert.rejects(get("https://example.com", { timeoutMs: 50 }), (err) => {
      return err && (err.name === "AbortError" || /aborted/i.test(err.message));
    });
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 200, `elapsed ${elapsed}ms`);
  } finally {
    global.fetch = originalFetch;
  }
});

test("get rejects network errors cleanly", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("network down");
  };
  try {
    await assert.rejects(get("https://example.com", { timeoutMs: 1000 }), /network down/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("get rejects body-read errors cleanly", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    status: 200,
    headers: { get: () => "text/plain" },
    text: async () => {
      throw new Error("body read failed");
    },
  });
  try {
    await assert.rejects(get("https://example.com", { timeoutMs: 1000 }), /body read failed/);
  } finally {
    global.fetch = originalFetch;
  }
});