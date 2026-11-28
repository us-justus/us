import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReportOnlyCsp, parseSupabaseOrigin } from "./csp.ts";

describe("report-only CSP", () => {
  it("accepts HTTPS origins and only loopback HTTP when explicitly enabled", () => {
    assert.equal(parseSupabaseOrigin("https://ietruyukgqwkmsyfvxxi.supabase.co"), "https://ietruyukgqwkmsyfvxxi.supabase.co");
    assert.equal(parseSupabaseOrigin("http://127.0.0.1:54321", true), "http://127.0.0.1:54321");
    assert.equal(parseSupabaseOrigin("http://localhost:54321", true), "http://localhost:54321");
    for (const value of [undefined, "", "http://supabase.test", "http://192.168.1.2:54321", "https://supabase.test/path", "https://user:pass@supabase.test"]) {
      assert.throws(() => parseSupabaseOrigin(value, true));
    }
    assert.throws(() => parseSupabaseOrigin("http://127.0.0.1:54321"));
  });

  it("contains only the verified application origins and stays report-only", () => {
    const policy = buildReportOnlyCsp("https://supabase.test");
    assert.match(policy, /connect-src 'self' https:\/\/supabase\.test/);
    assert.match(policy, /img-src 'self' data: blob: https:\/\/supabase\.test/);
    assert.ok(!policy.includes("unsafe-eval"));
    assert.ok(!policy.includes("*") && !policy.includes("report-uri"));
  });
});
