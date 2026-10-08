import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const MIG_URL = new URL(
  "../../../supabase/migrations/20261025000001_verification_records_service_role.sql",
  import.meta.url,
);
const MIG_DIR_URL = new URL("../../../supabase/migrations/", import.meta.url);

const mig = readFileSync(MIG_URL, "utf8");

/** Executable SQL only: assertions target granted privileges, never prose. */
function codeOnly(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const migCode = codeOnly(mig);

/**
 * Least-privilege service-role grant posture for verification_records.
 *
 * Production audit (Oct 2026): the service-role Data API client received
 * `permission denied for table verification_records`, 500ing every
 * server-side service-role path on that table — notably POST
 * /api/account/sync-verified-email, the intended healer for
 * Auth-confirmed / vr-email-empty rows. Sibling tables (profiles,
 * profile_photos) already carry explicit service_role grants; this table
 * was omitted. The new migration restores exactly the permissions the
 * existing server paths require — nothing more.
 */
describe("verification_records service_role grant migration", () => {
  it("grants exactly SELECT, INSERT, UPDATE to service_role", () => {
    assert.match(
      migCode,
      /grant\s+select,\s*insert,\s*update\s+on\s+table\s+public\.verification_records\s+to\s+service_role\s*;/i,
    );
  });

  it("grants no DELETE and touches no other role", () => {
    assert.doesNotMatch(migCode, /\bdelete\b/i);
    assert.doesNotMatch(migCode, /\bto\s+(public|anon|authenticated)\b/i);
  });

  it("changes no RLS, policies, ownership, or auth configuration", () => {
    assert.doesNotMatch(migCode, /row level security/i);
    assert.doesNotMatch(migCode, /create policy/i);
    assert.doesNotMatch(migCode, /alter table/i);
    assert.doesNotMatch(migCode, /owner to/i);
  });
});

describe("verification_records grant posture across all migrations", () => {
  // Every GRANT naming this table, in every migration: grantee must be an
  // intended server/client role only — never public or anon.
  const grantLines: { file: string; line: string; grantee: string }[] = [];
  for (const file of readdirSync(MIG_DIR_URL).filter((f) => f.endsWith(".sql"))) {
    const body = codeOnly(readFileSync(new URL(file, MIG_DIR_URL), "utf8"));
    for (const m of body.matchAll(
      /^.*grant\s+[\w,\s]+\bon\s+(?:table\s+|function\s+)?public\.verification_records\b.*$/gim,
    )) {
      const to = m[0].match(/\bto\s+([a-z_]+)/i);
      grantLines.push({ file, line: m[0].trim().slice(0, 160), grantee: (to?.[1] ?? "?").toLowerCase() });
    }
  }

  it("grants this table only to authenticated (owner RLS writes) and service_role (server)", () => {
    assert.ok(grantLines.length > 0, "expected at least one verification_records grant");
    for (const g of grantLines) {
      assert.ok(
        g.grantee === "authenticated" || g.grantee === "service_role",
        `${g.file}: unexpected grantee ${g.grantee}: ${g.line}`,
      );
    }
  });

  it("intended grants are present exactly once each", () => {
    const authenticated = grantLines.filter((g) => g.grantee === "authenticated");
    const service = grantLines.filter((g) => g.grantee === "service_role");
    assert.equal(authenticated.length, 1, "owner-RLS client grant must exist once");
    assert.match(authenticated[0].line, /select,\s*insert,\s*update/i);
    assert.equal(service.length, 1, "server grant must exist once");
    assert.match(service[0].line, /select,\s*insert,\s*update/i);
    assert.doesNotMatch(service[0].line, /\bdelete\b/i);
  });
});
