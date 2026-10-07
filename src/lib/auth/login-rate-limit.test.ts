import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_THROTTLED_MESSAGE,
  adminLoginRateLimitKeys,
  loginRateLimitKeys,
  normalizeAdminLoginIdentity,
  getClientIp,
} from "./login-rate-limit.ts";

const HEX64 = /^[0-9a-f]{64}$/;

describe("admin login rate-limit keys", () => {
  it("are deterministic for the same inputs", () => {
    const a = adminLoginRateLimitKeys("1.2.3.4", "admin@example.com");
    const b = adminLoginRateLimitKeys("1.2.3.4", "admin@example.com");
    assert.deepEqual(a, b);
  });

  it("separate unrelated IPs and identities into different buckets", () => {
    const base = adminLoginRateLimitKeys("1.2.3.4", "admin@example.com");
    const otherIp = adminLoginRateLimitKeys("5.6.7.8", "admin@example.com");
    const otherId = adminLoginRateLimitKeys("1.2.3.4", "other@example.com");
    assert.notEqual(base.ipKey, otherIp.ipKey);
    assert.notEqual(base.ipIdKey, otherId.ipIdKey);
    // Cross-dimension isolation: IP bucket unaffected by identity change.
    assert.equal(base.ipKey, otherId.ipKey);
  });

  it("never persist raw IPs or identifiers (hex digests only)", () => {
    const ip = "203.0.113.7";
    const id = "Admin@Example.COM";
    const { ipKey, ipIdKey } = adminLoginRateLimitKeys(ip, id);
    const digests = [ipKey.replace(/^admin-ip:/, ""), ipIdKey.replace(/^admin-ip-id:/, "")];
    for (const d of digests) {
      assert.match(d, HEX64);
      assert.ok(!d.includes(ip), "raw IP must not appear");
      assert.ok(!d.toLowerCase().includes("admin@example.com"), "raw identifier must not appear");
    }
  });

  it("never share a bucket with product student login", () => {
    const admin = adminLoginRateLimitKeys("1.2.3.4", "AB12CD34");
    const product = loginRateLimitKeys("1.2.3.4", "AB12CD34");
    assert.notEqual(admin.ipKey, product.ipKey);
    assert.notEqual(admin.ipIdKey, product.ipUsnKey);
  });

  it("exposes the shared throttled message", () => {
    assert.equal(typeof LOGIN_THROTTLED_MESSAGE, "string");
    assert.ok(LOGIN_THROTTLED_MESSAGE.length > 0);
  });
});

describe("normalizeAdminLoginIdentity", () => {
  it("lowercases email identifiers", () => {
    assert.equal(normalizeAdminLoginIdentity("  Admin@Example.COM "), "admin@example.com");
  });

  it("normalizes USN identifiers like the product", () => {
    assert.equal(normalizeAdminLoginIdentity("  ab12cd34 "), "AB12CD34");
  });

  it("reduces phone identifiers to digits", () => {
    assert.equal(normalizeAdminLoginIdentity("+1 (555) 123-4567"), "15551234567");
  });

  it("maps case/space variants of one identity to one bucket", () => {
    const a = adminLoginRateLimitKeys("9.9.9.9", normalizeAdminLoginIdentity("Admin@X.com"));
    const b = adminLoginRateLimitKeys("9.9.9.9", normalizeAdminLoginIdentity("  admin@x.COM "));
    assert.deepEqual(a, b);
  });
});

describe("trusted client IP", () => {
  it("uses Cloudflare connecting IP and ignores spoofed forwarding headers", () => {
    const req = new Request("https://example.test", { headers: {
      "cf-connecting-ip": "203.0.113.8",
      "x-forwarded-for": "198.51.100.1, 192.0.2.1",
      "x-real-ip": "192.0.2.9",
    } });
    assert.equal(getClientIp(req), "203.0.113.8");
  });

  it("ignores spoofed forwarded headers when Cloudflare metadata is absent", () => {
    const req = new Request("https://example.test", { headers: { "x-forwarded-for": "198.51.100.10" } });
    assert.notEqual(getClientIp(req), "198.51.100.10");
  });
});
