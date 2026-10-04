import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { verifySameOrigin } from "./origin.ts";

function req(headers: Record<string, string>): Request {
  return { headers: new Headers(headers) } as Request;
}

describe("verifySameOrigin", () => {
  it("allows a same-origin http request (local dev)", () => {
    const v = verifySameOrigin(
      req({ origin: "http://localhost:3000", host: "localhost:3000" }),
    );
    assert.deepEqual(v, { ok: true });
  });

  it("allows a same-origin LAN request (physical-phone testing)", () => {
    const v = verifySameOrigin(
      req({ origin: "http://192.168.0.100:3000", host: "192.168.0.100:3000" }),
    );
    assert.deepEqual(v, { ok: true });
  });

  it("allows a same-origin https request (staging/production)", () => {
    const v = verifySameOrigin(
      req({ origin: "https://us.example.com", host: "us.example.com" }),
    );
    assert.deepEqual(v, { ok: true });
  });

  it("honors x-forwarded-host behind a proxy", () => {
    const v = verifySameOrigin(
      req({
        origin: "https://us.example.com",
        host: "internal:3000",
        "x-forwarded-host": "us.example.com",
      }),
    );
    assert.deepEqual(v, { ok: true });
  });

  it("compares hosts case-insensitively", () => {
    const v = verifySameOrigin(
      req({ origin: "https://APP.EXAMPLE.COM", host: "app.example.com" }),
    );
    assert.deepEqual(v, { ok: true });
  });

  it("rejects a foreign origin", () => {
    const v = verifySameOrigin(
      req({ origin: "https://evil.example", host: "us.example.com" }),
    );
    assert.deepEqual(v, { ok: false, reason: "mismatch" });
  });

  it("rejects a same-host different-port origin", () => {
    const v = verifySameOrigin(
      req({ origin: "http://localhost:9999", host: "localhost:3000" }),
    );
    assert.deepEqual(v, { ok: false, reason: "mismatch" });
  });

  it("rejects a malformed origin", () => {
    assert.deepEqual(verifySameOrigin(req({ origin: "not a url", host: "a" })), {
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects the sandboxed-frame 'null' origin", () => {
    assert.deepEqual(
      verifySameOrigin(req({ origin: "null", host: "us.example.com" })),
      { ok: false, reason: "malformed" },
    );
  });

  it("rejects non-http(s) schemes", () => {
    assert.deepEqual(
      verifySameOrigin(req({ origin: "ftp://us.example.com", host: "us.example.com" })),
      { ok: false, reason: "malformed" },
    );
  });

  it("allows an absent Origin (curl/server/test callers; auth stays authoritative)", () => {
    assert.deepEqual(verifySameOrigin(req({ host: "us.example.com" })), { ok: true });
  });

  it("rejects when sameness cannot be established (no host)", () => {
    assert.deepEqual(
      verifySameOrigin(req({ origin: "https://us.example.com" })),
      { ok: false, reason: "missing-host" },
    );
  });
});
