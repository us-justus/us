import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReportOnlyCsp, parseSupabaseOrigin } from "./csp.ts";

describe("report-only CSP", () => {
  it("accepts only an exact HTTPS Supabase origin", () => {
    assert.equal(parseSupabaseOrigin("https://ietruyukgqwkmsyfvxxi.supabase.co"), "https://ietruyukgqwkmsyfvxxi.supabase.co");
    for (const value of [undefined, "", "http://supabase.test", "https://supabase.test/path", "https://user:pass@supabase.test"]) {
      assert.throws(() => parseSupabaseOrigin(value));
    }
  });

  it("contains only the verified application origins and stays report-only", () => {
    const policy = buildReportOnlyCsp("https://supabase.test");
    assert.match(policy, /connect-src 'self' https:\/\/supabase\.test/);
    assert.match(policy, /img-src 'self' data: blob: https:\/\/supabase\.test/);
    assert.ok(!policy.includes("unsafe-eval"));
    assert.ok(!policy.includes("*") && !policy.includes("report-uri"));
  });
});
