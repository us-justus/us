import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const MIG_URL = new URL(
  "../../../supabase/migrations/20261021000001_onboarding_password_set.sql",
  import.meta.url,
);
const STATE_URL = new URL("./state.ts", import.meta.url);
const FORM_URL = new URL(
  "../../app/onboarding/password/form.tsx",
  import.meta.url,
);
const REMEDIATION_URL = new URL(
  "../../../supabase/migrations/20261019000001_security_remediation.sql",
  import.meta.url,
);

const mig = await readFile(MIG_URL, "utf8");
const state = await readFile(STATE_URL, "utf8");
const form = await readFile(FORM_URL, "utf8");
const remediation = await readFile(REMEDIATION_URL, "utf8");

/**
 * Function definition of record_onboarding_password (the CREATE FUNCTION
 * statement onward — header/scope comments above it intentionally name the
 * columns the RPC must NOT touch, so they are excluded here).
 */
function rpcBody(): string {
  const marker = "create or replace function public.record_onboarding_password()";
  const idx = mig.indexOf(marker);
  assert.ok(idx >= 0, "migration must define record_onboarding_password");
  const rest = mig.slice(idx);
  // Only the CREATE FUNCTION statement itself (through its $$ body close) —
  // trailing REVOKE/GRANT/COMMENT lines intentionally name the columns the
  // RPC must not touch, so they are excluded here.
  const end = rest.indexOf("$$;");
  assert.ok(end >= 0, "RPC body must close");
  return rest.slice(0, end);
}

describe("A. verified email + password_set_at NULL resolves to password", () => {
  it("state reads password_set_at from verification_records", () => {
    assert.ok(
      state.includes("password_set_at"),
      "state must read password_set_at",
    );
    assert.match(
      state,
      /select\("usn, email, email_skipped, password_set_at"\)/,
    );
  });

  it("verified user with NULL password_set_at and no profile returns password", () => {
    assert.match(
      state,
      /if\s*\(!vr\?\.password_set_at\)\s*\{[\s\S]*?return done\("password"\)/,
      "NULL password_set_at must resolve to the password step",
    );
  });
});

describe("B. verified email + password_set_at set resolves to profile", () => {
  it("a recorded password_set_at falls through to the profile tail", () => {
    const nullCheck = state.indexOf("if (!vr?.password_set_at)");
    assert.ok(nullCheck >= 0, "NULL check must exist");
    const tail = state.slice(nullCheck);
    assert.ok(
      tail.includes('return done("profile")'),
      "set password_set_at must continue to profile",
    );
  });
});

describe("C. existing profile is never forced back to password", () => {
  it("the profile lookup precedes the password_set_at check (grandfather)", () => {
    const profileCheck = state.indexOf("if (profile)");
    const nullCheck = state.indexOf("if (!vr?.password_set_at)");
    assert.ok(profileCheck >= 0, "profile grandfather check must exist");
    assert.ok(nullCheck >= 0, "password_set_at check must exist");
    assert.ok(
      profileCheck < nullCheck,
      "existing profile must return before the password gate",
    );
  });

  it("profile/photos/complete tail remains intact", () => {
    assert.ok(state.includes('done("photos")'), "photos tail must remain");
    assert.ok(state.includes('done("complete")'), "complete tail must remain");
  });
});

describe("D. verification-link flow lands on password, cannot bounce early", () => {
  it("the server redirect is preserved (no ?verified=1 trust)", () => {
    assert.ok(
      form.includes('if (step && step !== "password" && next)'),
      "server redirect must stay — fixed state makes it authoritative",
    );
    assert.ok(
      !form.includes('searchParams.get("verified")') ||
        form.includes("justVerified"),
      "form must not route on the raw param",
    );
  });

  it("state never trusts a client verified flag", () => {
    for (const banned of [
      'body?.emailVerified',
      'body?.verified',
      'searchParams.get("verified")',
    ]) {
      assert.ok(!state.includes(banned), `state must not trust ${banned}`);
    }
    assert.ok(
      state.includes("hasRealVerifiedEmail"),
      "state keeps the canonical Auth check",
    );
  });

  it("the I've-verified-continue behavior is preserved", () => {
    assert.ok(
      form.includes("i've verified — continue"),
      "continue affordance must remain",
    );
    assert.ok(
      form.includes("Email verified — set a password to finish."),
      "verified notice must remain",
    );
    assert.ok(
      form.includes('setPhase("password")'),
      "verified phase must remain",
    );
  });
});

describe("E. successful password update records password_set_at", () => {
  it("form calls updateUser then the recorder RPC, then navigates", () => {
    const updateIdx = form.indexOf("updateUser({ password })");
    const rpcIdx = form.indexOf('rpc("record_onboarding_password")');
    const navIdx = form.indexOf("router.push(next");
    assert.ok(updateIdx >= 0, "Supabase password write must remain");
    assert.ok(rpcIdx >= 0, "recorder RPC must be called");
    assert.ok(
      updateIdx < rpcIdx,
      "RPC must run only after the password write succeeds",
    );
    assert.ok(
      rpcIdx < navIdx,
      "navigation must wait for both operations",
    );
  });

  it("the password itself is never sent to the RPC", () => {
    assert.ok(
      !form.includes('rpc("record_onboarding_password",'),
      "RPC must take no arguments (no password, no user_id)",
    );
    assert.doesNotMatch(
      form,
      /record_onboarding_password[^;]*password/,
      "password value must never reach the RPC call",
    );
  });

  it("RPC sets password_set_at for the caller row and preserves first-set", () => {
    const body = rpcBody();
    assert.match(body, /set password_set_at = coalesce\(password_set_at, now\(\)\)/i);
    assert.match(body, /where user_id = v_user/i);
  });
});

describe("F. password update failure does not record password_set_at", () => {
  it("an updateUser error throws before the RPC is reached", () => {
    const updateIdx = form.indexOf("updateUser({ password })");
    assert.ok(updateIdx >= 0);
    const afterUpdate = form.slice(updateIdx);
    const throwIdx = afterUpdate.indexOf(
      'throw new Error("Could not set password.',
    );
    const rpcIdx = afterUpdate.indexOf('rpc("record_onboarding_password")');
    assert.ok(throwIdx >= 0 && rpcIdx >= 0, "both paths must exist");
    assert.ok(
      throwIdx < rpcIdx,
      "failed password write must throw before recording",
    );
  });

  it("an RPC failure surfaces instead of navigating", () => {
    const rpcIdx = form.indexOf('rpc("record_onboarding_password")');
    assert.ok(rpcIdx >= 0);
    const afterRpc = form.slice(rpcIdx);
    assert.ok(
      afterRpc.includes("recordError"),
      "RPC error must be checked",
    );
    assert.ok(
      afterRpc.indexOf("Could not set password.") <
        afterRpc.indexOf("router.push(next"),
      "RPC failure must not navigate",
    );
  });
});

describe("G. RPC cannot be called anonymously", () => {
  it("a null auth.uid() raises 42501", () => {
    const body = rpcBody();
    assert.match(body, /v_user uuid := auth\.uid\(\)/i);
    assert.match(body, /if v_user is null/i);
    assert.match(body, /errcode = '42501'/i);
  });

  it("EXECUTE is revoked from PUBLIC/anon, granted to authenticated only", () => {
    assert.match(
      mig,
      /revoke all on function public\.record_onboarding_password\(\) from public, anon/i,
    );
    assert.match(
      mig,
      /grant execute on function public\.record_onboarding_password\(\) to authenticated/i,
    );
    assert.doesNotMatch(
      mig,
      /grant execute on function public\.record_onboarding_password[^\n]*\banon\b/i,
    );
    assert.doesNotMatch(
      mig,
      /grant execute on function public\.record_onboarding_password[^\n]*\bpublic\b/i,
    );
  });
});

describe("H. RPC cannot target another user's row", () => {
  it("the function takes zero arguments", () => {
    assert.match(
      mig,
      /create or replace function public\.record_onboarding_password\(\)/i,
    );
    const body = rpcBody();
    assert.doesNotMatch(body, /p_user_id|p_invitee_user_id|p_email/i);
  });

  it("every write is scoped to auth.uid()", () => {
    const body = rpcBody();
    assert.match(body, /where user_id = v_user/i);
    assert.doesNotMatch(body, /where user_id = p_/i);
  });
});

describe("I. RPC cannot establish email verification", () => {
  it("the RPC never writes email_verified_at, email, or other identity fields", () => {
    const body = rpcBody();
    assert.doesNotMatch(body, /email_verified_at/i);
    assert.doesNotMatch(body, /\bemail\b\s*=/i);
    assert.doesNotMatch(body, /\busn\b\s*=/i);
    assert.doesNotMatch(body, /verification_status\s*=/i);
    assert.doesNotMatch(body, /email_skipped\s*=/i);
  });

  it("no generic verification_records updater was created", () => {
    const fns = [...mig.matchAll(/create or replace function public\.(\w+)\(/gi)].map(
      (m) => m[1],
    );
    assert.deepEqual(
      fns.filter((n) => !n.startsWith("guard_")),
      ["record_onboarding_password"],
    );
  });

  it("the RPC is SECURITY DEFINER with a fixed safe search_path", () => {
    const body = rpcBody();
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path = pg_catalog, public, auth, pg_temp/i);
  });
});

describe("J. remediation + RLS posture preserved (not weakened)", () => {
  it("direct PostgREST writes to password_set_at stay blocked", () => {
    assert.match(
      mig,
      /if current_user not in \('authenticated', 'anon'\) then/i,
      "trusted-server-path exemption must key on current_user",
    );
    assert.match(mig, /password_set_at is server-managed/i);
  });

  it("no broad table grants or policies were added", () => {
    assert.doesNotMatch(
      mig,
      /grant\s+(all|select|insert|update).*\bon table public\.verification_records/i,
    );
    assert.doesNotMatch(mig, /create policy/i);
  });

  it("existing remediation boundaries still hold", () => {
    assert.match(
      remediation,
      /revoke insert on table public\.matches from public, anon, authenticated/i,
    );
    assert.match(
      remediation,
      /revoke all on table public\.profiles from public, anon, authenticated/i,
    );
    assert.match(mig, /add column if not exists password_set_at timestamptz/i);
  });
});
