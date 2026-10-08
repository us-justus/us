import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * Admin spot-allocation exclusion (two-layer fix).
 *
 * REGRESSION: the admin account once completed normal student onboarding and
 * consumed student waitlist spot #2. POST /api/onboarding/profile allocated
 * for any authenticated caller passing the verified-email gate, and
 * allocate_campus_spot() did not independently reject admins.
 *
 * LAYERS (both server-side; never client/UI hiding):
 *   1. Route guard: POST /api/onboarding/profile checks is_admin() on the
 *      session client before the username pre-check and before the profile
 *      upsert. Fail closed: an unknown role-check outcome never writes.
 *      (Profile creation no longer allocates: the permanent spot is minted
 *      at the completion boundary by finalize_onboarding_completion(), which
 *      carries the same admin refusal as its own defense-in-depth layer.)
 *   2. Allocator guard: allocate_campus_spot() refuses admin callers
 *      (is_admin(), 42501), closing the check-then-allocate race and any
 *      future direct allocator caller.
 */

const routeUrl = new URL(
  "../../app/api/onboarding/profile/route.ts",
  import.meta.url,
);
const migrationUrl = new URL(
  "../../../supabase/migrations/20261022000001_allocate_spot_reject_admin.sql",
  import.meta.url,
);
const priorMigrationUrl = new URL(
  "../../../supabase/migrations/20261019000001_security_remediation.sql",
  import.meta.url,
);

describe("admin spot exclusion: route guard", () => {
  it("checks is_admin() on the session client before the profile upsert", async () => {
    const src = await readFile(routeUrl, "utf8");
    assert.ok(
      src.includes('supabase.rpc("is_admin")'),
      "route must check is_admin() via the session client (auth.uid-based, no client identity)",
    );
    const guardAt = src.indexOf('supabase.rpc("is_admin")');
    const upsertAt = src.indexOf('.from("profiles").upsert(');
    assert.ok(upsertAt > 0, "profile upsert path must exist");
    assert.ok(
      guardAt < upsertAt,
      "admin check must precede the profile upsert",
    );
  });

  it("denies admins without writing (fail closed)", async () => {
    const src = await readFile(routeUrl, "utf8");
    const guardBlock = src.slice(
      src.indexOf('supabase.rpc("is_admin")'),
      src.indexOf('.from("profiles").upsert('),
    );
    assert.match(guardBlock, /status:\s*403/, "admin denial must be 403");
    assert.ok(
      guardBlock.includes("adminCheckError") || guardBlock.includes("adminError"),
      "an unknown role-check outcome (RPC error) must also deny, never write",
    );
  });

  it("never allocates at profile creation (completion boundary owns spots)", async () => {
    const src = await readFile(routeUrl, "utf8");
    assert.ok(
      !src.includes('rpc("allocate_campus_spot")'),
      "profile creation must not call the allocator — spots are minted at the completion boundary",
    );
    assert.ok(
      src.includes("finalize_onboarding_completion()"),
      "profile route must document the completion-boundary owner",
    );
  });

  it("preserves the student path exactly", async () => {
    const src = await readFile(routeUrl, "utf8");
    assert.ok(
      src.includes("requireVerifiedEmailForWrite"),
      "verified-email gate must remain for students",
    );
    assert.ok(
      src.includes('.from("profiles").upsert('),
      "student profile upsert must remain the single profile writer",
    );
    assert.ok(
      src.includes("prev?.spot ?? null"),
      "existing spots must be preserved exactly, new profiles written with spot NULL",
    );
  });
});

describe("admin spot exclusion: allocator guard (defense in depth)", () => {
  it("refuses admin callers with 42501 before consuming a number", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    assert.match(
      migration,
      /if\s+public\.is_admin\(\)\s+then\s+raise exception[^;]*42501/,
      "allocator must refuse admins via is_admin() with 42501",
    );
    const guardAt = migration.search(/public\.is_admin\(\)/);
    const consumeAt = migration.search(/next_spot\s*=\s*next_spot\s*\+\s*1/);
    assert.ok(consumeAt > 0, "atomic counter increment must be preserved");
    assert.ok(
      guardAt < consumeAt,
      "admin refusal must precede the counter increment",
    );
  });

  it("preserves idempotent allocation and least-privilege grants", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    assert.match(
      migration,
      /on conflict \(user_id\) do nothing/i,
      "per-user claim idempotency must be preserved",
    );
    assert.match(
      migration,
      /revoke all on function public\.allocate_campus_spot\(\) from public, anon/i,
      "anon/public must stay revoked",
    );
    assert.match(
      migration,
      /grant execute on function public\.allocate_campus_spot\(\) to authenticated/i,
      "authenticated-only EXECUTE must be preserved",
    );
    assert.doesNotMatch(
      migration,
      /grant execute on function public\.allocate_campus_spot\(\)[^;]*(public|anon)/i,
      "grants must not widen to public/anon",
    );
  });

  it("changes no tables, RLS, data, or login behavior", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    // Strip -- comments: prose may name tables, but no statement may touch them.
    const code = migration
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    assert.doesNotMatch(code, /alter table/i, "no schema changes");
    assert.doesNotMatch(code, /create policy|drop policy/i, "no RLS changes");
    assert.doesNotMatch(
      code,
      /(insert into|update|delete from|drop table)\s+(public\.)?admin_users/i,
      "admin_users must not be written",
    );
    assert.doesNotMatch(code, /next_spot\s*=\s*1/i, "allocator counter must not be reset");
    assert.doesNotMatch(
      migration,
      /resolve_login_email|resolve_phone_login_email/i,
      "login resolvers must not be touched",
    );
    const prior = await readFile(priorMigrationUrl, "utf8");
    assert.ok(
      prior.includes("insert into public.campus_spot_claims(user_id, spot)"),
      "sanity: prior allocator shape still the reference for preserved behavior",
    );
  });
});

describe("admin spot exclusion: single-writer invariant", () => {
  it("PATCH /api/profile still rejects username/spot (no second writer)", async () => {
    const patch = await readFile(
      new URL("../../app/api/profile/route.ts", import.meta.url),
      "utf8",
    );
    assert.ok(
      patch.includes("username !== undefined || spot !== undefined"),
      "PATCH must keep rejecting identity keys",
    );
  });
});
