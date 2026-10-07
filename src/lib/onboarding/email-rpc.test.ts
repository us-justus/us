import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const RPC_MIG_URL = new URL(
  "../../../supabase/migrations/20261020000001_onboarding_email_rpc.sql",
  import.meta.url,
);
const REMEDIATION_URL = new URL(
  "../../../supabase/migrations/20261019000001_security_remediation.sql",
  import.meta.url,
);
const ROUTE_URL = new URL(
  "../../app/api/onboarding/email/route.ts",
  import.meta.url,
);

const rpcMig = await readFile(RPC_MIG_URL, "utf8");
const remediation = await readFile(REMEDIATION_URL, "utf8");
const route = await readFile(ROUTE_URL, "utf8");

/** Function body of save_onboarding_email (between its $$ delimiters). */
function rpcBody(): string {
  const idx = rpcMig.indexOf("save_onboarding_email");
  assert.ok(idx >= 0, "RPC migration must define save_onboarding_email");
  return rpcMig.slice(idx);
}

describe("A. authenticated user can save their own onboarding email", () => {
  it("route calls the trusted RPC with only the validated email", () => {
    assert.ok(route.includes('rpc("save_onboarding_email"'), "route must call the RPC");
    assert.ok(route.includes("p_email"), "route must pass p_email");
    assert.ok(route.includes("validateAccountEmail"), "existing email validation preserved");
    assert.ok(route.includes("auth.getUser()"), "UID still derived from the session");
  });

  it("RPC derives the row from auth.uid() and upserts the caller-owned row", () => {
    const body = rpcBody();
    assert.match(body, /v_user uuid := auth\.uid\(\)/i);
    assert.match(body, /on conflict\s*\(user_id\)\s*do update/i);
    assert.match(body, /values\s*\(v_user,\s*v_email,\s*false,\s*null\)/i);
    assert.match(
      rpcMig,
      /grant execute on function public\.save_onboarding_email\(text\) to authenticated/i,
    );
  });

  it("successful save still returns { ok: true }", () => {
    assert.ok(route.includes("return NextResponse.json({ ok: true })"), "success shape unchanged");
  });
});

describe("B. authenticated user cannot write another user's verification record", () => {
  it("RPC takes no user_id argument", () => {
    assert.match(
      rpcMig,
      /create or replace function public\.save_onboarding_email\(p_email text\)/i,
    );
    const body = rpcBody();
    assert.doesNotMatch(body, /p_user_id|p_invitee_user_id|user_id\s+uuid/i);
  });

  it("route never accepts user_id from the request body", () => {
    for (const banned of ["body?.user_id", "body.user_id", "body?.userId", "body[\"user_id\"]"]) {
      assert.ok(!route.includes(banned), `route must not contain ${banned}`);
    }
    // The old broken email write path must be gone (the emailFirst bare-row
    // insert below still derives user_id from the session, which is allowed).
    assert.ok(!route.includes("upsert({ user_id"), "email save must not upsert directly");
    assert.ok(!route.includes("signUp("), "route must never signUp");
  });

  it("every write targets the caller row (v_user) only", () => {
    const body = rpcBody();
    assert.ok(body.includes("where user_id = v_user") || body.includes("values (v_user,"),
      "writes must be scoped to auth.uid()");
    assert.doesNotMatch(body, /where user_id = p_/i);
  });
});

describe("C. unauthenticated caller cannot invoke the trusted operation", () => {
  it("RPC rejects a null auth.uid()", () => {
    const body = rpcBody();
    assert.match(body, /if v_user is null/i);
    assert.match(body, /errcode = '42501'/i);
  });

  it("route returns 401 before any write", () => {
    const authIdx = route.indexOf("auth.getUser()");
    const rpcIdx = route.indexOf('rpc("save_onboarding_email"');
    assert.ok(authIdx >= 0 && rpcIdx > authIdx, "auth check must precede the RPC call");
    assert.ok(route.includes('status: 401'), "unauthenticated -> 401 preserved");
  });

  it("EXECUTE is revoked from PUBLIC/anon", () => {
    assert.match(
      rpcMig,
      /revoke all on function public\.save_onboarding_email\(text\) from public, anon/i,
    );
    assert.doesNotMatch(rpcMig, /grant execute on function public\.save_onboarding_email[^\n]*\banon\b/i);
    assert.doesNotMatch(rpcMig, /grant execute on function public\.save_onboarding_email[^\n]*\bpublic\b/i);
  });
});

describe("D. authenticated user cannot modify protected verification fields", () => {
  it("RPC writes only email, email_skipped, and trust clearing", () => {
    const body = rpcBody();
    assert.ok(body.includes("email_skipped = false"), "legacy skip flag always cleared");
    assert.ok(body.includes("email_verified_at"), "trust cleared on address change");
    for (const banned of ["usn", "verification_status", "email_verified boolean", "phone_verified"]) {
      assert.ok(!body.toLowerCase().includes(`new.${banned}`) && !body.includes(`set ${banned} =`),
        `RPC must not write ${banned}`);
    }
    assert.doesNotMatch(body, /\busn\b\s*=/i);
    assert.doesNotMatch(body, /verification_status\s*=/i);
  });

  it("RPC clears trust on address change but preserves it for a re-submitted address", () => {
    const body = rpcBody();
    assert.match(body, /else null/i);
    assert.match(body, /lower\(coalesce\(public\.verification_records\.email/i);
  });

  it("RPC has a fixed safe search_path and is SECURITY DEFINER narrow", () => {
    const body = rpcBody();
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path = pg_catalog, public, auth, pg_temp/i);
  });

  it("no generic verification_records updater was created", () => {
    const fns = [...rpcMig.matchAll(/create or replace function public\.(\w+)\(/gi)].map((m) => m[1]);
    assert.deepEqual(
      fns.filter((n) => !n.startsWith("guard_")),
      ["save_onboarding_email"],
    );
  });
});

describe("E. security-remediation posture preserved (RLS NOT weakened)", () => {
  it("remediation still blocks direct authenticated email writes", () => {
    assert.match(remediation, /verification email is server-managed/i);
    // The exemption keys on current_user (definer/owner context), never on
    // a caller-controlled value — direct authenticated PostgREST writes run
    // as `authenticated` and still hit the raise.
    assert.match(rpcMig, /if current_user not in \('authenticated', 'anon'\) then return new/i);
  });

  it("no broad INSERT/UPDATE grants on verification_records were added", () => {
    assert.doesNotMatch(rpcMig, /grant\s+(all|select|insert|update).*\bon table public\.verification_records/i);
    assert.doesNotMatch(rpcMig, /create policy/i);
  });

  it("existing remediation boundaries still hold", () => {
    assert.match(remediation, /revoke insert on table public\.matches from public, anon, authenticated/i);
    assert.match(remediation, /revoke all on table public\.profiles from public, anon, authenticated/i);
    assert.match(
      remediation,
      /grant execute on function public\.resolve_login_email\(text, text\) to service_role/i,
    );
  });
});

describe("F. original 'Could not save email.' failure path is covered", () => {
  it("RPC failure still surfaces the same error (regression covered)", () => {
    assert.ok(route.includes('"Could not save email."'), "failure message preserved");
    const rpcIdx = route.indexOf('rpc("save_onboarding_email"');
    const failIdx = route.indexOf('"Could not save email."');
    assert.ok(rpcIdx >= 0 && failIdx > rpcIdx, "RPC error maps to the known failure message");
  });

  it("required-email + skip-rejection semantics unchanged", () => {
    assert.ok(route.includes("status: 410"), "skip still rejected with 410");
    assert.ok(route.includes("emailRequired: true"), "emailRequired still always true");
    assert.ok(!route.includes("email_skipped: true"), "no new skip is ever recorded");
  });
});
