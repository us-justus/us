import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sniffImageMime } from "../photos/sniff.ts";
import { safeNextPath } from "../auth/safe-next.ts";
import { readJsonBounded } from "../http/read-json-bounded.ts";

const migration = await readFile(
  new URL(
    "../../../supabase/migrations/20261019000001_security_remediation.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("security remediation boundaries", () => {
  it("guards protected profile fields and removes direct match insertion", () => {
    assert.match(migration, /guard_profile_security_fields/);
    for (const field of [
      "is_active",
      "suspension_reason",
      "suspended_at",
      "suspended_by",
      "spot",
      "username",
    ]) {
      assert.ok(migration.includes(field));
    }
    assert.match(
      migration,
      /revoke insert on table public\.matches from public, anon, authenticated/i,
    );
    assert.match(migration, /drop policy if exists "own matches insert"/i);
    assert.match(
      migration,
      /grant insert \(user_id, category, message\) on table public\.feedback to authenticated/i,
    );
  });

  it("binds notification actor and referral invitee to authenticated identity", () => {
    assert.match(migration, /v_actor uuid := auth\.uid\(\)/i);
    assert.match(migration, /notification actor must be caller/i);
    assert.match(migration, /v_invitee uuid := auth\.uid\(\)/i);
  });

    it("limits profile and photo reads to owners or active profile rows", async () => {
    assert.match(
      migration,
      /discover active profiles select[\s\S]*is_active is true/i,
    );
    assert.match(
      migration,
      /visible profile photos select[\s\S]*p\.is_active is true/i,
    );
    assert.doesNotMatch(migration, /using\s*\(\s*true\s*\)/i);
    assert.match(
      migration,
      /revoke all on table public\.profiles from public, anon, authenticated/i,
    );
    assert.match(
      migration,
      /view public\.discoverable_profiles[\s\S]*select username, spot, nickname, age, year, branch, bio, interests/i,
    );

    const projection =
      migration.match(
        /view public\.discoverable_profiles[\s\S]*?select ([\s\S]*?)\nfrom public\.profiles/i,
      )?.[1] ?? "";

    assert.doesNotMatch(
      projection,
      /user_id|is_active|suspension_reason|suspended_at|suspended_by/i,
    );

    const genderMigration = await readFile(
      new URL(
        "../../../supabase/migrations/20261026000001_add_profile_gender.sql",
        import.meta.url,
      ),
      "utf8",
    );

    assert.match(
      genderMigration,
      /add column if not exists gender text null/i,
    );
    assert.match(
      genderMigration,
      /gender in \('Male', 'Female'\)/i,
    );
    assert.match(
      genderMigration,
      /select[\s\S]*?interests,\s*gender\s+from public\.profiles/i,
    );
    assert.match(
      genderMigration,
      /revoke all on table public\.discoverable_profiles from public, anon, authenticated/i,
    );
    assert.match(
      genderMigration,
      /grant select on table public\.discoverable_profiles to authenticated/i,
    );

   const genderProjection =
  genderMigration.match(
    /create or replace view public\.discoverable_profiles[\s\S]*?select\s+([\s\S]*?)\s+from public\.profiles/i,
  )?.[1] ?? "";

    assert.match(genderProjection, /\bgender\b/i);
    assert.doesNotMatch(
      genderProjection,
      /user_id|email|usn|is_active|suspension_reason|suspended_at|suspended_by/i,
    );
  });

  it("removes direct storage write policies so uploads pass byte validation", () => {
    assert.match(migration, /drop policy if exists "own update photos"/i);
    assert.match(migration, /drop policy if exists "own upload photos"/i);
    assert.match(
      migration,
      /No authenticated storage UPDATE policy is[\s\S]*retained/i,
    );
  });

  it("accepts internal redirects and rejects encoded or external targets", () => {
    assert.equal(safeNextPath("/settings/account"), "/settings/account");
    for (const value of [
      "https://evil.test",
      "//evil.test",
      "/%2f%2fevil.test",
      "/javascript:alert(1)",
      "/%ZZ",
    ]) {
      assert.equal(safeNextPath(value), null);
    }
  });

  it("checks image signatures and rejects mislabeled or truncated data", () => {
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01,
      0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00,
      0x00, 0x3f, 0x00, 0x7f, 0xff, 0xd9,
    ]);
    assert.equal(sniffImageMime(jpeg), "image/jpeg");
    assert.equal(
      sniffImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9])),
      null,
    );

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ2kAAAAASUVORK5CYII=",
      "base64",
    );
    assert.equal(sniffImageMime(png), "image/png");
    assert.equal(
      sniffImageMime(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
      null,
    );
    assert.equal(sniffImageMime(new TextEncoder().encode("MZ executable")), null);
  });

  it("adds shared security response headers", async () => {
    const config = await readFile(
      new URL("../../../next.config.ts", import.meta.url),
      "utf8",
    );
    for (const header of [
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      assert.ok(config.includes(header));
    }
  });

  it("preserves mutual-like match creation and service-role-only login resolution", async () => {
    const discover = await readFile(
      new URL(
        "../../../supabase/migrations/20250916000003_discover.sql",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(discover, /if v_exists then[\s\S]*insert into public\.matches/i);
    assert.match(
      migration,
      /revoke all on function public\.resolve_login_email\(text, text\) from public, anon, authenticated/i,
    );
    assert.match(
      migration,
      /grant execute on function public\.resolve_login_email\(text, text\) to service_role/i,
    );
  });

  it("limits admin mutation routes and daily verification requests", async () => {
    const adminRoutes = [
      "../../../src/app/api/inside/reports/resolve/route.ts",
      "../../../src/app/api/inside/students/moderate/route.ts",
      "../../../src/app/api/inside/feedback/resolve/route.ts",
      "../../../src/app/api/inside/feedback/reply/route.ts",
      "../../../src/app/api/inside/email-queue/route.ts",
      "../../../src/app/api/inside/email-queue/send/route.ts",
    ];

    for (const path of adminRoutes) {
      assert.match(
        await readFile(new URL(path, import.meta.url), "utf8"),
        /insideMutationRateLimit/,
      );
    }

    const worker = await readFile(
      new URL("../../../src/lib/email-verification/worker.ts", import.meta.url),
      "utf8",
    );
    assert.match(worker, /MAX_VERIFICATION_EMAILS_PER_ACCOUNT_DAY\s*=\s*5/);
    assert.match(
      worker,
      /from\("email_verification_queue"\)[\s\S]*gte\("created_at", dayAgo\)/,
    );
  });

  it("checks feedback reply recipients against the verified Auth identity", async () => {
    const route = await readFile(
      new URL("../../../src/app/api/inside/feedback/reply/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(route, /email_verified_at/);
    assert.match(route, /auth\.admin\.getUserById\(row\.user_id\)/);
    assert.match(
      route,
      /confirmedAuthEmail\.trim\(\)\.toLowerCase\(\) !== String\(recipient\)/,
    );
  });

  it("rejects oversized JSON bodies after reading the stream", async () => {
    const over = new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ data: "x".repeat(80) }),
    });
    assert.equal(await readJsonBounded(over, 32), null);

    const good = new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ ok: true }),
    });
    assert.deepEqual(await readJsonBounded(good, 32), { ok: true });
  });

  it("uses a server-side profile service client and gates profile table access in SQL", async () => {
    const profileRoute = await readFile(
      new URL("../../../src/app/api/profile/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(profileRoute, /createServiceRoleClient\(\)/);
    assert.match(
      migration,
      /revoke all on table public\.profiles from public, anon, authenticated/i,
    );
    assert.match(
      migration,
      /grant select, insert, update, delete on table public\.profiles to service_role/i,
    );
  });
});